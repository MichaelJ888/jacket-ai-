"use client";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "hidden", margin: 0, padding: 0 }}>
      <iframe
        src="/index.html"
        style={{ width: "100%", height: "100%", border: "none" }}
        title="Michael Jeffrey International Corporation Website"
      />
    </main>
  );
}