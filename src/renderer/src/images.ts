import type { MessageImage } from "../../shared/types";

/** As much as the model looks at: anything larger is scaled down to this before it is sent. */
const longestEdge = 1568;
// The API refuses an image over 5 MB; a PNG past this many bytes is re-encoded as JPEG instead.
const pngLimit = 3.7 * 1024 * 1024;

export async function pastedImage(file: File): Promise<MessageImage> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
	const width = Math.round(bitmap.width * scale);
	const height = Math.round(bitmap.height * scale);

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const png = base64Of(canvas.toDataURL("image/png"));
	if ((png.length * 3) / 4 <= pngLimit) return { mediaType: "image/png", data: png, width, height };

	return { mediaType: "image/jpeg", data: base64Of(canvas.toDataURL("image/jpeg", 0.9)), width, height };
}

export function imageSource(image: MessageImage): string {
	return `data:${image.mediaType};base64,${image.data}`;
}

function base64Of(dataUrl: string): string {
	return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
