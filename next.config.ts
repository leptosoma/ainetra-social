import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Server Actions varsayılan gövde sınırı 1 MB'dir; medya yükleme formu görsel
  // (≤8 MB, bkz. MAX_UPLOAD_BYTES) ve video (≤80 MB, bkz. MAX_VIDEO_UPLOAD_BYTES)
  // için Server Action üzerinden çalıştığından bu sınır yükseltilmelidir.
  // multipart/form-data boundary/alan başlıkları için ek pay bırakılmıştır.
  experimental: {
    serverActions: {
      bodySizeLimit: "90mb",
    },
  },
};

export default nextConfig;
