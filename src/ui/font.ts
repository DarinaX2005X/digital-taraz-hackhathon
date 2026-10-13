import localFont from "next/font/local";

export const tirlikFont = localFont({
  src: [
    { path: "../../public/fonts/noto-sans/NotoSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/noto-sans/NotoSans-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/noto-sans/NotoSans-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/noto-sans/NotoSans-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-tirlik-sans",
  display: "swap",
  preload: true,
  fallback: ["Arial", "sans-serif"],
  adjustFontFallback: "Arial",
});
