"use client";

import { useState } from "react";

type ExportJob = {
  id: string;
  output_url: string | null;
  product_title: string | null;
};

type Props = { jobs: ExportJob[] };

const SLIDE_MS = 2800;
const MAX_SLIDES = 8;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A Studio image could not be loaded for local video export."));
    image.src = url;
  });
}

function supportedVideoType() {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

export default function StudioReelExport({ jobs }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [fileType, setFileType] = useState("");

  function toggleJob(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < MAX_SLIDES ? [...current, id] : current);
  }

  async function exportSlideshow() {
    setError("");
    setBusy(true);
    let recorder: MediaRecorder | null = null;
    let audioContext: AudioContext | null = null;
    let animationId = 0;
    let stream: MediaStream | null = null;
    try {
      if (!("MediaRecorder" in window) || !("captureStream" in HTMLCanvasElement.prototype)) {
        throw new Error("This browser does not support local Canvas video recording.");
      }
      const selected = jobs
        .filter((job): job is ExportJob & { output_url: string } => selectedIds.includes(job.id) && Boolean(job.output_url))
        .slice(0, MAX_SLIDES);
      if (!selected.length) throw new Error("Select at least one finished Studio image.");
      const mimeType = supportedVideoType();
      if (!mimeType) throw new Error("This browser cannot encode MP4 or WebM video.");

      const audio = new AudioContext();
      audioContext = audio;
      await audio.resume();
      const destination = audio.createMediaStreamDestination();
      const volume = audio.createGain();
      volume.gain.value = 0.012;
      volume.connect(destination);
      for (const frequency of [110, 164.81, 220]) {
        const oscillator = audio.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        oscillator.connect(volume);
        oscillator.start();
      }

      const images = await Promise.all(selected.map((job) => loadImage(job.output_url)));
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
      stream = canvas.captureStream(30);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      const complete = new Promise<Blob>((resolve, reject) => {
        recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
        recorder!.onerror = () => reject(new Error("Browser video encoding failed."));
      });
      recorder.start(250);
      const started = performance.now();
      const draw = (timestamp: number) => {
        const elapsed = timestamp - started;
        const index = Math.min(images.length - 1, Math.floor(elapsed / SLIDE_MS));
        context.fillStyle = "#071a33";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const image = images[index];
        const scale = Math.min(canvas.width / image.naturalWidth, 1420 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, (canvas.width - width) / 2, (1450 - height) / 2, width, height);
        context.fillStyle = "#fff";
        context.textAlign = "center";
        context.font = "700 56px Arial";
        context.fillText("MJIC", canvas.width / 2, 1570);
        context.font = "600 42px Arial";
        context.fillText((selected[index].product_title || "Custom Apparel").slice(0, 42), canvas.width / 2, 1640, 960);
        context.font = "400 30px Arial";
        context.fillText("Custom garment production · Philippines", canvas.width / 2, 1710);
        if (elapsed < images.length * SLIDE_MS) animationId = requestAnimationFrame(draw);
        else recorder?.stop();
      };
      animationId = requestAnimationFrame(draw);
      const blob = await complete;
      if (!blob.size) throw new Error("The generated slideshow is empty.");
      setVideoUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(blob);
      });
      setFileType(mimeType.includes("mp4") ? "mp4" : "webm");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the local slideshow.");
    } finally {
      if (animationId) cancelAnimationFrame(animationId);
      if (recorder?.state === "recording") recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      await audioContext?.close().catch(() => undefined);
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-cyan-300/30 bg-zinc-950 p-4 text-zinc-100">
      <h2 className="text-lg font-bold text-cyan-100">Vertical Reel / TikTok slideshow</h2>
      <p className="mt-1 text-sm text-zinc-400">Select up to {MAX_SLIDES} Studio images. Browser Canvas and Web Audio render a 1080×1920 video locally; no paid API or upload is used.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-2 rounded border border-zinc-700 p-2 text-sm">
            <input type="checkbox" checked={selectedIds.includes(job.id)} disabled={!selectedIds.includes(job.id) && selectedIds.length >= MAX_SLIDES} onChange={() => toggleJob(job.id)} />
            <span className="truncate">{job.product_title || "Studio image"}</span>
          </li>
        ))}
        {!jobs.length && <li className="text-sm text-zinc-400">Finished image outputs will be available here.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || selectedIds.length === 0} onClick={() => void exportSlideshow()} className="rounded bg-cyan-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Rendering locally…" : "Export vertical slideshow"}
        </button>
        {videoUrl && <a className="rounded border border-cyan-300 px-3 py-2 text-sm font-semibold text-cyan-100" href={videoUrl} download={`mjic-studio-reel.${fileType}`}>Download {fileType.toUpperCase()}</a>}
      </div>
      <p className="mt-2 text-xs text-zinc-500">The browser exports the format it supports (MP4 or WebM). Verify platform format requirements before upload.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </section>
  );
}
