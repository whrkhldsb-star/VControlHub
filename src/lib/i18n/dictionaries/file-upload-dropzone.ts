/**
 * i18n dictionary: `fileUploadDropzone.*` (5 keys).
 *
 * Used by `src/components/storage/file-upload-dropzone.tsx` — the shared
 * LOCAL/SFTP upload dropzone reused on `/files` and `/image-bed`. Keeps the
 * node selector label, directory placeholder copy, folder-mode button text,
 * and folder-mode help string aligned across both surfaces.
 */
export const zh: Record<string, string> = {
	"fileUploadDropzone.uploadToNode": "上传到节点",
	"fileUploadDropzone.selectStorageNode": "请选择存储节点",
	"fileUploadDropzone.selectFolderAriaLabel": "选择整个文件夹",
	"fileUploadDropzone.selectFolder": "选择文件夹",
	"fileUploadDropzone.folderHelpText": "主按钮可多选文件；文件夹模式会保留浏览器提供的子目录结构。",
};

export const en: Record<string, string> = {
	"fileUploadDropzone.uploadToNode": "Upload to node",
	"fileUploadDropzone.selectStorageNode": "Select a storage node",
	"fileUploadDropzone.selectFolderAriaLabel": "Select an entire folder",
	"fileUploadDropzone.selectFolder": "Select folder",
	"fileUploadDropzone.folderHelpText":
		"The main button accepts multiple files; folder mode preserves the relative subdirectory structure provided by the browser.",
};
