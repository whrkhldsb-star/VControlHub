package main

import (
	"os"
	"path/filepath"
	"syscall"
)

const safeOpenFlags = 0

func singleLink(f *os.File, _ os.FileInfo) bool {
	var i syscall.ByHandleFileInformation
	return syscall.GetFileInformationByHandle(syscall.Handle(f.Fd()), &i) == nil && i.NumberOfLinks == 1 && i.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT == 0
}

// NTFS also resolves DOS short names and names with different casing. The
// hub checks path grants against the long names returned by directory listing.
func exactEntry(root *os.Root, name string, info os.FileInfo) bool {
	if name == "." {
		return true
	}
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	if !ok || data.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return false
	}
	path, err := syscall.UTF16PtrFromString(filepath.Join(root.Name(), filepath.FromSlash(name)))
	if err != nil {
		return false
	}
	var found syscall.Win32finddata
	handle, err := syscall.FindFirstFile(path, &found)
	if err != nil {
		return false
	}
	defer syscall.FindClose(handle)
	return syscall.UTF16ToString(found.FileName[:]) == filepath.Base(name)
}
