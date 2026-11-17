export function responsiveImage(src: string, sizes: string) {
  if (!src.startsWith("https://images.unsplash.com/")) return {};
  const image = new URL(src);
  image.searchParams.set("auto", "format");
  image.searchParams.set("q", "80");
  return {
    sizes,
    srcSet: [160, 240, 400, 640, 800, 1200].map((width) => {
      image.searchParams.set("w", String(width));
      return `${image.href} ${width}w`;
    }).join(", "),
  };
}
