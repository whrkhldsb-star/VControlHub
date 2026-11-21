package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
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

func directoryID(dir *os.File) (string, error) {
	var info syscall.ByHandleFileInformation
	if err := syscall.GetFileInformationByHandle(syscall.Handle(dir.Fd()), &info); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d:%d", info.VolumeSerialNumber, info.FileIndexHigh, info.FileIndexLow), nil
}

// FileRenameInformation with ReplaceIfExists=false handles both files and directories.
func renameAtExclusive(src *os.File, from string, dst *os.File, to string) error {
	name, err := windows.NewNTUnicodeString(from)
	if err != nil {
		return err
	}
	oa := windows.OBJECT_ATTRIBUTES{RootDirectory: windows.Handle(src.Fd()), ObjectName: name}
	oa.Length = uint32(unsafe.Sizeof(oa))
	var file windows.Handle
	var status windows.IO_STATUS_BLOCK
	err = windows.NtCreateFile(&file, windows.DELETE|windows.SYNCHRONIZE, &oa, &status, nil, 0,
		windows.FILE_SHARE_DELETE|windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, windows.FILE_OPEN,
		windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(file)
	name16, err := windows.UTF16FromString(to)
	if err != nil || len(name16) > 256 {
		return invalid
	}
	info := struct {
		Replace   uint32
		Directory windows.Handle
		Length    uint32
		Name      [256]uint16
	}{Directory: windows.Handle(dst.Fd()), Length: uint32((len(name16) - 1) * 2)}
	copy(info.Name[:], name16)
	err = windows.NtSetInformationFile(file, &status, (*byte)(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), windows.FileRenameInformation)
	if err == windows.STATUS_OBJECT_NAME_COLLISION {
		return os.ErrExist
	}
	return err
}
