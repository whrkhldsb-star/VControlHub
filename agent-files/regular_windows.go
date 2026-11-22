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

// FileRenameInformation addresses the destination relative to its open directory.
func renameAt(src *os.File, from string, dst *os.File, to string, overwrite bool) error {
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
	return setFileName(file, dst, to, windows.FileRenameInformation, overwrite)
}

func publishOpenFile(parent *os.Root, original *os.File, from, to string) error {
	dir, err := parent.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	name, err := windows.NewNTUnicodeString(from)
	if err != nil {
		return err
	}
	oa := windows.OBJECT_ATTRIBUTES{RootDirectory: windows.Handle(dir.Fd()), ObjectName: name}
	oa.Length = uint32(unsafe.Sizeof(oa))
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	err = windows.NtCreateFile(&handle, windows.FILE_WRITE_ATTRIBUTES|windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, &oa, &status, nil, 0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
		windows.FILE_OPEN, windows.FILE_OPEN_REPARSE_POINT|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(handle), from)
	defer file.Close()
	want, err := original.Stat()
	actual, lookup := file.Stat()
	if err != nil || lookup != nil || !os.SameFile(want, actual) {
		return changed
	}
	// NT FileLinkInformation (MS-FSCC), with ReplaceIfExists=false.
	const fileLinkInformation = 11 // FILE_INFORMATION_CLASS in ntifs.h
	return setFileName(handle, dir, to, fileLinkInformation, false)
}

func setFileName(file windows.Handle, dst *os.File, to string, class uint32, overwrite bool) error {
	var status windows.IO_STATUS_BLOCK
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
	if overwrite {
		info.Replace = 1
	}
	copy(info.Name[:], name16)
	err = windows.NtSetInformationFile(file, &status, (*byte)(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), class)
	if err == windows.STATUS_OBJECT_NAME_COLLISION {
		return os.ErrExist
	}
	return err
}

func changeIdentity(root *os.Root, name string, st os.FileInfo, f *os.File) (string, error) {
	if f == nil {
		var err error
		f, err = root.Open(name)
		if err != nil {
			return "", err
		}
		defer f.Close()
		actual, err := f.Stat()
		if err != nil || !os.SameFile(actual, st) {
			return "", changed
		}
	}
	id, err := directoryID(f)
	if err != nil {
		return "", err
	}
	var basic struct {
		Creation, Access, Write, Change int64
		Attributes, Padding             uint32
	}
	err = windows.GetFileInformationByHandleEx(windows.Handle(f.Fd()), windows.FileBasicInfo, (*byte)(unsafe.Pointer(&basic)), uint32(unsafe.Sizeof(basic)))
	return fmt.Sprintf("%s:%x:%x", id, basic.Creation, basic.Change), err
}

func lockExecutor(f *os.File) error {
	return windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{})
}

// Shares reject reparse points, including child volume mount points.
func (s share) deletionMountRoot(_ string) (*os.Root, error) { return s.root.OpenRoot(".") }

func agentOwnsDirectory(handle windows.Handle, agent *windows.SID) bool {
	var info windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(handle, &info) != nil || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return false
	}
	sd, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return false
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil || !owner.Equals(agent) {
		return false
	}
	control, _, err := sd.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return false
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil || acl.AceCount == 0 {
		return false
	}
	for i := uint16(0); i < acl.AceCount; i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(acl, uint32(i), &ace) != nil || ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE {
			return false
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !sid.Equals(agent) && !sid.IsWellKnown(windows.WinLocalSystemSid) {
			return false
		}
	}
	return true
}

// Set a protected DACL at creation. When reusing the directory, check its
// owner and DACL using the handle, then pin this identity in deletionDirectory.
func openPrivateDirectory(parent *os.Root, name string) (*os.File, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	sid := user.User.Sid.String()
	sd, err := windows.SecurityDescriptorFromString("O:" + sid + "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + sid + ")")
	if err != nil {
		return nil, err
	}
	dir, err := parent.Open(".")
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	unicode, err := windows.NewNTUnicodeString(name)
	if err != nil {
		return nil, err
	}
	oa := windows.OBJECT_ATTRIBUTES{RootDirectory: windows.Handle(dir.Fd()), ObjectName: unicode, SecurityDescriptor: sd}
	oa.Length = uint32(unsafe.Sizeof(oa))
	var handle windows.Handle
	var status windows.IO_STATUS_BLOCK
	err = windows.NtCreateFile(&handle, windows.READ_CONTROL|windows.FILE_READ_ATTRIBUTES|windows.SYNCHRONIZE, &oa, &status, nil, 0,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, windows.FILE_OPEN_IF,
		windows.FILE_OPEN_REPARSE_POINT|windows.FILE_DIRECTORY_FILE|windows.FILE_SYNCHRONOUS_IO_NONALERT, 0, 0)
	if err != nil {
		return nil, err
	}
	if !agentOwnsDirectory(handle, user.User.Sid) {
		windows.CloseHandle(handle)
		return nil, denied
	}
	return os.NewFile(uintptr(handle), name), nil
}
