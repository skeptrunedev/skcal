import * as ImagePicker from "expo-image-picker";
import type { UploadImage } from "./api";

// The picker re-encodes what it returns (JPEG at quality < 1) but reports the
// original file's type (e.g. HEIC), so the label comes from the bytes, not
// mimeType. The worker only accepts jpeg/png/webp/gif.
export const imageTypeOf = (base64: string): string =>
  base64.startsWith("/9j/") ? "image/jpeg" : base64.startsWith("iVBORw0KGgo") ? "image/png" : base64.startsWith("R0lGOD") ? "image/gif" : base64.startsWith("UklGR") ? "image/webp" : "image/jpeg";

export const PICKER_OPTS = {
  mediaTypes: ["images"] as ImagePicker.MediaType[],
  quality: 0.7,
  base64: true,
} as const;

/** Picker asset → an upload part labelled with its real (re-encoded) type. */
export const toUpload = (a: ImagePicker.ImagePickerAsset): UploadImage => ({
  uri: a.uri,
  mimeType: a.base64 ? imageTypeOf(a.base64) : a.mimeType,
});

/** Library pick (multiple allowed); [] when cancelled. */
export async function pickFromLibrary(multiple: boolean): Promise<ImagePicker.ImagePickerAsset[]> {
  const res = await ImagePicker.launchImageLibraryAsync({ ...PICKER_OPTS, allowsMultipleSelection: multiple });
  return res.canceled ? [] : res.assets;
}

/** Camera capture; [] when cancelled or camera access is denied. */
export async function pickFromCamera(): Promise<ImagePicker.ImagePickerAsset[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchCameraAsync(PICKER_OPTS);
  return res.canceled ? [] : res.assets;
}
