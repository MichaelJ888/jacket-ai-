import type { Metadata } from "next";

import VideoMockupStudio from "./video-mockup-studio";

export const metadata: Metadata = {
  title: "Video Mockups & Campaign Planner | MJIC Admin",
  robots: { index: false, follow: false },
};

export default function VideoMockupsPage() {
  return <VideoMockupStudio />;
}
