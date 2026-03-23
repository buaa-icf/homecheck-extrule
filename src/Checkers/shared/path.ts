export function getBaseName(filePath: string): string {
    const segments = filePath.split(/[\\/]/);
    return segments[segments.length - 1] || filePath;
}
