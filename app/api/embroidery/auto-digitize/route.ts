import { NextResponse } from 'next/server';
import {
  createDigitizeJob,
  estimateStitchCount,
  sendTelegramMessage,
  sendTelegramPhoto,
} from '../../_lib/integrations';

// Calls a self-hosted Ink/Stitch CLI or EmbroideryIO-compatible HTTP service to
// convert a PNG/SVG logo into a .DST embroidery machine file. Configure
// EMBROIDERY_DIGITIZE_API_URL (and optionally EMBROIDERY_DIGITIZE_API_KEY) to
// enable live conversion. Without it, the job is queued for manual digitizing
// and the artist is notified via Telegram with the logo attached.
function isValidImageSource(image: unknown): image is string {
  return typeof image === 'string' && (/^https?:\/\//i.test(image) || /^data:image\/(png|svg\+xml);base64,/i.test(image));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const image = body.image;
    if (!isValidImageSource(image)) {
      return NextResponse.json({ error: 'image must be a data:image/png or data:image/svg+xml base64 URL, or an https URL' }, { status: 400 });
    }

    const placement = typeof body.placement === 'string' ? body.placement.trim() : '';
    const widthInches = Number(body.widthInches) || 0;
    const heightInches = Number(body.heightInches) || 0;
    const projectName = typeof body.projectName === 'string' ? body.projectName : '';
    const clientName = typeof body.clientName === 'string' ? body.clientName : '';
    const stitchEstimate = estimateStitchCount(widthInches, heightInches);

    const apiUrl = process.env.EMBROIDERY_DIGITIZE_API_URL;
    const apiKey = process.env.EMBROIDERY_DIGITIZE_API_KEY;
    const provider = process.env.EMBROIDERY_DIGITIZE_PROVIDER || 'ink-stitch-self-hosted';

    if (!apiUrl) {
      const result = await createDigitizeJob({
        embroideryJobId: typeof body.embroideryJobId === 'string' ? body.embroideryJobId : undefined,
        sourceImage: image,
        placement,
        widthInches,
        heightInches,
        status: 'PENDING_MANUAL_DIGITIZING',
        stitchCount: stitchEstimate,
        notes: 'Auto-digitize service is not configured (EMBROIDERY_DIGITIZE_API_URL missing). Routed for manual digitizing.',
      });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });

      const caption = [
        '🧵 <b>MANUAL DIGITIZING NEEDED</b>',
        `Project: <b>${projectName || 'Not provided'}</b>`,
        `Client: <b>${clientName || 'Not provided'}</b>`,
        placement ? `Placement: <b>${placement}</b>` : '',
        `Estimated Stitch Count: <b>${stitchEstimate.toLocaleString('en-PH')}</b>`,
        'Auto-digitize service is not connected yet — please digitize this logo manually into DST.',
      ].filter(Boolean).join('\n');
      void sendTelegramPhoto(image, caption);

      return NextResponse.json({ success: true, requiresManualDigitizing: true, job: result.data });
    }

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ image, widthInches, heightInches, placement }),
        signal: AbortSignal.timeout(20000),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload) {
        const result = await createDigitizeJob({ sourceImage: image, placement, widthInches, heightInches, status: 'FAILED', provider, stitchCount: stitchEstimate, notes: `Digitize service returned ${response.status}` });
        void sendTelegramMessage(`⚠️ <b>DST AUTO-DIGITIZE FAILED</b>\nProject: ${projectName || 'Not provided'}\nStatus code: ${response.status}\nFalling back to manual digitizing.`);
        return NextResponse.json({ success: false, error: 'Digitize service failed', job: result.data }, { status: 502 });
      }

      const stitchCount = Number(payload.stitchCount) || stitchEstimate;
      const result = await createDigitizeJob({
        sourceImage: image,
        placement,
        widthInches,
        heightInches,
        status: 'COMPLETED',
        provider,
        dstFileUrl: payload.dstFileUrl || undefined,
        dstFileBase64: payload.dstFileBase64 || undefined,
        stitchCount,
      });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });

      void sendTelegramMessage([
        '✅ <b>DST FILE READY</b>',
        `Project: <b>${projectName || 'Not provided'}</b>`,
        `Stitch Count: <b>${stitchCount.toLocaleString('en-PH')}</b>`,
        payload.dstFileUrl ? `Download: ${payload.dstFileUrl}` : 'DST file attached in ERP record.',
      ].join('\n'));

      return NextResponse.json({ success: true, requiresManualDigitizing: false, job: result.data });
    } catch (providerError) {
      const message = providerError instanceof Error ? providerError.message : 'Digitize provider unreachable';
      const result = await createDigitizeJob({ sourceImage: image, placement, widthInches, heightInches, status: 'FAILED', provider, stitchCount: stitchEstimate, notes: message });
      void sendTelegramMessage(`⚠️ <b>DST AUTO-DIGITIZE ERROR</b>\n${message}\nFalling back to manual digitizing.`);
      return NextResponse.json({ success: false, error: message, job: result.data }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Auto-digitize request failed' }, { status: 400 });
  }
}
