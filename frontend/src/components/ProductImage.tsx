import type { SyntheticEvent } from "react";

type ProductImageProps = {
  sku: string;
  name: string;
  remoteUrl?: string;
};

function cleanSku(value: string) {
  return String(value || "").trim().toUpperCase();
}

export default function ProductImage({ sku, name, remoteUrl }: ProductImageProps) {
  const safeSku = cleanSku(sku);

  const candidates = [
    `/products/${safeSku}.webp`,
    `/products/${safeSku}.jpg`,
    `/products/${safeSku}.jpeg`,
    `/products/${safeSku}.png`,
    remoteUrl || "",
  ].filter(Boolean);

  function handleError(event: SyntheticEvent<HTMLImageElement>) {
    const img = event.currentTarget;
    const index = Number(img.dataset.index || "0");
    const nextIndex = index + 1;

    if (nextIndex < candidates.length) {
      img.dataset.index = String(nextIndex);
      img.src = candidates[nextIndex];
      return;
    }

    img.style.display = "none";

    const parent = img.parentElement;
    if (parent) {
      parent.classList.add("image-fallback-on");
      parent.setAttribute("data-fallback", safeSku || name);
    }
  }

  return (
    <img
      src={candidates[0]}
      data-index="0"
      alt={name}
      loading="lazy"
      decoding="async"
      onError={handleError}
    />
  );
}
