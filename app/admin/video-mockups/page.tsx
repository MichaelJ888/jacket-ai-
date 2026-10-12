import type { Metadata } from "next";

import VideoMockupStudio from "./video-mockup-studio";

export const metadata: Metadata = {
  title: "Local Video Mockups | MJIC Admin",
  robots: { index: false, follow: false },
};

export default function VideoMockupsPage() {
  return <VideoMockupStudio />;
}
