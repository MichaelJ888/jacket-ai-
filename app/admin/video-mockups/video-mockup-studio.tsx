"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  getWebmMimeType,
  makeVideoFilename,
  MAX_IMAGE_PIXELS,
  validateImageFile,
  VIDEO_DURATION_SECONDS,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from "./mockup-logic";

const inputClass = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900";
const buttonClass = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

type Artwork = {
  image: ImageBitmap;
  filename: string;
};

function drawContain(
  context: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  context.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
}

function drawMockupFrame(
  context: CanvasRenderingContext2D,
  artwork: Artwork | null,
  logo: ImageBitmap | null,
  clientName: string,
  progress: number,
) {
  const { width, height } = context.canvas;
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#071629");
  background.addColorStop(0.55, "#102a4a");
  background.addColorStop(1, "#060d18");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width * 0.5, height * 0.45, 40, width * 0.5, height * 0.45, 580);
  glow.addColorStop(0, "rgba(201, 160, 60, 0.18)");
  glow.addColorStop(1, "rgba(201, 160, 60, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.textAlign = "center";
  context.fillStyle = "#d4b261";
  context.font = "600 25px Arial, sans-serif";
  context.fillText("A CUSTOM JACKET MOCKUP", width / 2, 132);

  context.fillStyle = "#ffffff";
  context.font = "700 54px Arial, sans-serif";
  const title = clientName.trim() || "YOUR TEAM";
  let titleSize = 54;
  while (titleSize > 30 && context.measureText(title).width > width - 96) {
    titleSize -= 2;
    context.font = `700 ${titleSize}px Arial, sans-serif`;
  }
  context.fillText(title, width / 2, 220);

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = 36;
  context.shadowOffsetY = 18;
  context.fillStyle = "#f6f5f0";
  context.beginPath();
  context.roundRect(58, 310, width - 116, 650, 34);
  context.fill();
  context.restore();

  if (artwork) {
    const zoom = 1 + Math.sin(progress * Math.PI) * 0.025;
    context.save();
    context.beginPath();
    context.roundRect(72, 324, width - 144, 622, 26);
    context.clip();
    context.translate(width / 2, 635);
    context.scale(zoom, zoom);
    drawContain(context, artwork.image, -(width - 200) / 2, -275, width - 200, 550);
    context.restore();
  } else {
    context.fillStyle = "#334155";
    context.font = "500 26px Arial, sans-serif";
    context.fillText("Upload a finished jacket mockup to preview", width / 2, 640);
  }

  if (logo) {
    context.save();
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(width / 2 - 90, 1000, 180, 100, 18);
    context.fill();
    drawContain(context, logo, width / 2 - 78, 1010, 156, 80);
    context.restore();
  } else {
    context.fillStyle = "#ffffff";
    context.font = "700 29px Arial, sans-serif";
    context.fillText("MJIC  ·  MADE FOR YOUR TEAM", width / 2, 1045);
  }

  context.fillStyle = "#e8d5a1";
  context.font = "500 27px Arial, sans-serif";
  context.fillText("DESIGNED AROUND YOUR BRAND", width / 2, 1150);
  context.fillStyle = "rgba(255, 255, 255, 0.76)";
  context.font = "400 21px Arial, sans-serif";
  context.fillText("Custom apparel by Michael Jeffrey International Corporation", width / 2, 1200);
}

async function checkAdminToken(token: string) {
  const response = await fetch("/api/admin/prices", {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("That admin password was not accepted.");
  }
  if (!response.ok) throw new Error(`Admin access check failed (${response.status}).`);
}

export default function VideoMockupStudio() {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [clientName, setClientName] = useState("YOUR TEAM");
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [logo, setLogo] = useState<ImageBitmap | null>(null);
  const [logoFilename, setLogoFilename] = useState("");
  const [message, setMessage] = useState("");
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const verifyToken = useCallback(async (value: string) => {
    await checkAdminToken(value);
    sessionStorage.setItem("mjic_admin", value);
    setToken(value);
    setAuthed(true);
    setMessage("");
  }, []);

  useEffect(() => {
    let active = true;
    const saved = sessionStorage.getItem("mjic_admin");
    if (!saved) return () => { active = false; };

    void checkAdminToken(saved).then(() => {
      if (!active) return;
      setToken(saved);
      setAuthed(true);
    }).catch((error: unknown) => {
      if (!active) return;
      sessionStorage.removeItem("mjic_admin");
      setMessage(error instanceof Error ? error.message : "Could not verify the admin session.");
    });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (artwork) return () => artwork.image.close();
  }, [artwork]);

  useEffect(() => {
    if (logo) return () => logo.close();
  }, [logo]);

  useEffect(() => {
    if (downloadUrl) return () => URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (context) drawMockupFrame(context, artwork, logo, clientName, 0.45);
  }, [artwork, logo, clientName]);

  async function loadImage(file: File | undefined, kind: "artwork" | "logo") {
    if (!file) return;
    const error = validateImageFile(file, kind);
    if (error) {
      setMessage(error);
      return;
    }

    try {
      const image = await createImageBitmap(file);
      if (image.width * image.height > MAX_IMAGE_PIXELS) {
        image.close();
        setMessage("This image is too large to render smoothly. Resize it to 24 megapixels or less.");
        return;
      }
      if (kind === "artwork") {
        setArtwork({ image, filename: file.name });
      } else {
        setLogo(image);
        setLogoFilename(file.name);
      }
      setMessage("");
    } catch {
      setMessage("This image could not be decoded. Try exporting it as PNG, JPEG, or WebP.");
    }
  }

  async function exportVideo() {
    const canvas = canvasRef.current;
    if (!canvas || !artwork) {
      setMessage("Upload the finished jacket artwork before rendering a video.");
      return;
    }
    if (!("MediaRecorder" in window) || !canvas.captureStream) {
      setMessage("This browser does not support local video recording. Use a recent desktop version of Chrome or Edge.");
      return;
    }

    const mimeType = getWebmMimeType((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) {
      setMessage("This browser does not support WebM recording. Use a recent desktop version of Chrome or Edge.");
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      setMessage("The video canvas could not be initialized. Reload the page and try again.");
      return;
    }

    const stream = canvas.captureStream(VIDEO_FPS);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setMessage("The browser could not start its video encoder. Try a recent desktop version of Chrome or Edge.");
      return;
    }

    const chunks: Blob[] = [];
    setRendering(true);
    setProgress(0);
    setMessage("Rendering on this device. Keep this tab open until the download is ready.");

    const recorded = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error("The browser's video recorder encountered an error."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    let animationId = 0;
    try {
      recorder.start(250);
      const startedAt = performance.now();
      let lastProgressUpdate = startedAt - 100;
      await new Promise<void>((resolve) => {
        const draw = (now: number) => {
          const elapsed = now - startedAt;
          const ratio = Math.min(elapsed / (VIDEO_DURATION_SECONDS * 1000), 1);
          drawMockupFrame(context, artwork, logo, clientName, ratio);
          if (now - lastProgressUpdate >= 100 || ratio === 1) {
            setProgress(Math.floor(ratio * 100));
            lastProgressUpdate = now;
          }
          if (ratio < 1) {
            animationId = requestAnimationFrame(draw);
          } else {
            resolve();
          }
        };
        animationId = requestAnimationFrame(draw);
      });
      if (recorder.state === "recording") recorder.stop();
      const blob = await recorded;
      if (!blob.size) throw new Error("The browser returned an empty video file.");
      setDownloadUrl(URL.createObjectURL(blob));
      setProgress(100);
      setMessage(`Video ready (${(blob.size / (1024 * 1024)).toFixed(1)} MB). It was rendered locally and was not uploaded.`);
    } catch (error) {
      if (recorder.state === "recording") recorder.stop();
      setMessage(error instanceof Error ? error.message : "Video rendering failed.");
    } finally {
      cancelAnimationFrame(animationId);
      stream.getTracks().forEach((track) => track.stop());
      setRendering(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem("mjic_admin");
    setAuthed(false);
    setToken("");
    setMessage("");
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-sm p-8 text-zinc-900">
        <a className="text-sm underline" href="/admin">← MJIC Admin</a>
        <h1 className="mb-2 mt-6 text-2xl font-bold">Local jacket video mockups</h1>
        <p className="mb-4 text-sm text-zinc-600">Sign in with your MJIC admin password. Artwork stays in this browser.</p>
        <form onSubmit={(event) => { event.preventDefault(); void verifyToken(token).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Admin sign-in failed.")); }}>
          <label className="block text-sm font-medium" htmlFor="admin-password">Admin password</label>
          <input id="admin-password" className={inputClass} type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} />
          <button className={`${buttonClass} mt-3`} type="submit" disabled={!token}>Sign in</button>
        </form>
        {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <a className="text-sm text-zinc-600 underline" href="/admin">← MJIC Admin</a>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Jacket video mockups</h1>
            <p className="mt-1 text-sm text-zinc-600">Create an 8-second vertical product preview on this device.</p>
          </div>
          <button className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm" onClick={signOut}>Sign out</button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mx-auto max-w-[360px]">
              <canvas
                ref={canvasRef}
                width={VIDEO_WIDTH}
                height={VIDEO_HEIGHT}
                role="img"
                aria-label="Animated jacket mockup video preview"
                className="w-full rounded-xl bg-slate-950 shadow-lg"
              />
            </div>
            <p className="mt-3 text-center text-xs text-zinc-500">Vertical 9:16 · 720 × 1280 · {VIDEO_FPS} fps · WebM video</p>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Build a preview</h2>
            <p className="mt-1 text-sm text-zinc-600">Upload an already-approved jacket mockup image. This tool animates and brands that image; it does not invent or alter garment details.</p>

            <label className="mt-5 block text-sm font-medium" htmlFor="mockup-artwork">Finished jacket mockup (required)</label>
            <input
              ref={artworkInputRef}
              id="mockup-artwork"
              className={inputClass}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => { void loadImage(event.target.files?.[0], "artwork"); }}
            />
            <p className="mt-1 text-xs text-zinc-500">PNG, JPEG, or WebP · up to 12 MB and 24 megapixels. Use your finished front/back artwork for accurate garment details.</p>
            {artwork && (
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-600">
                <span className="truncate">{artwork.filename}</span>
                <button
                  className="shrink-0 underline"
                  onClick={() => {
                    setArtwork(null);
                    if (artworkInputRef.current) artworkInputRef.current.value = "";
                  }}
                >Remove</button>
              </div>
            )}

            <label className="mt-5 block text-sm font-medium" htmlFor="mockup-client-name">Client or team name</label>
            <input
              id="mockup-client-name"
              className={inputClass}
              maxLength={48}
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              placeholder="Your team"
            />

            <label className="mt-5 block text-sm font-medium" htmlFor="mockup-logo">Optional client logo</label>
            <input
              ref={logoInputRef}
              id="mockup-logo"
              className={inputClass}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => { void loadImage(event.target.files?.[0], "logo"); }}
            />
            <p className="mt-1 text-xs text-zinc-500">Shown in the title card only; it is not composited onto the garment.</p>
            {logoFilename && (
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-600">
                <span className="truncate">{logoFilename}</span>
                <button
                  className="shrink-0 underline"
                  onClick={() => {
                    setLogo(null);
                    setLogoFilename("");
                    if (logoInputRef.current) logoInputRef.current.value = "";
                  }}
                >Remove</button>
              </div>
            )}

            <div className="mt-6 border-t border-zinc-200 pt-5">
              <button className={buttonClass} disabled={!artwork || rendering} onClick={() => void exportVideo()}>
                {rendering ? `Rendering… ${progress}%` : "Render local WebM"}
              </button>
              {rendering && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200" aria-label={`Render progress ${progress}%`}>
                  <div className="h-full bg-amber-500 transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              )}
              {downloadUrl && !rendering && (
                <a className="mt-3 inline-block text-sm font-semibold text-blue-700 underline" href={downloadUrl} download={makeVideoFilename(clientName)}>
                  Download {makeVideoFilename(clientName)}
                </a>
              )}
            </div>
            {message && <p role="status" aria-live="polite" className="mt-4 text-sm text-zinc-700">{message}</p>}
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">
              Private by design: rendering happens in your browser. Artwork and logos are not sent to MJIC servers. Keep this page open while rendering. MP4 export is not guaranteed by browsers; this tool produces WebM.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
