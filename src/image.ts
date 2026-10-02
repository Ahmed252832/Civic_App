export function readImage(file: File): Promise<string> {
  return new Promise((resolve,reject) => {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8_000_000) return reject(new Error('Choose a PNG, JPEG or WebP image under 8 MB.'));
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      for (const [limit, quality] of [[1200,.78],[960,.67],[760,.55],[640,.45]] as const) {
        const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/webp', quality);
        if (result.length < 600000) return resolve(result);
      }
      reject(new Error('This image is too detailed. Choose a smaller photo.'));
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not read image.')); };
    image.src = objectUrl;
  });
}

