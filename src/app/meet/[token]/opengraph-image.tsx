import { ImageResponse } from "next/og";

// The picture in the link preview card. Next.js renders it and adds the og:image tag itself.
export const alt = "AI for Homebuilders: book a 15-minute call";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          background: "#0F3B3D",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -1 }}>AI for Homebuilders</div>
        <div style={{ fontSize: 40, marginTop: 18, opacity: 0.88 }}>Book a 15-minute call</div>
        <div style={{ width: 120, height: 8, marginTop: 44, borderRadius: 4, background: "#b48c3c" }} />
      </div>
    ),
    size,
  );
}
