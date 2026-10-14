// jobhost keeps the proxy process inside a Windows Job Object. Closing the
// helper or losing the Electron parent terminates the core and its children.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
	"unsafe"
)

type basicLimits struct {
	ProcessTime       int64
	JobTime           int64
	Flags             uint32
	MinimumWorkingSet uintptr
	MaximumWorkingSet uintptr
	ActiveProcesses   uint32
	Affinity          uintptr
	Priority          uint32
	Scheduling        uint32
}
type ioCounters struct{ ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes uint64 }
type extendedLimits struct {
	Basic                                                      basicLimits
	IO                                                         ioCounters
	ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory uintptr
}

var kernel = syscall.NewLazyDLL("kernel32.dll")
var createJob = kernel.NewProc("CreateJobObjectW")
var setJob = kernel.NewProc("SetInformationJobObject")
var assignJob = kernel.NewProc("AssignProcessToJobObject")
var wait = kernel.NewProc("WaitForSingleObject")

func run() int {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "jobhost: parent PID and core executable required")
		return 1
	}
	pid, err := strconv.ParseUint(os.Args[1], 10, 32)
	if err != nil {
		return 1
	}
	parent, err := syscall.OpenProcess(0x00100000, false, uint32(pid))
	if err != nil {
		fmt.Fprintln(os.Stderr, "jobhost: parent process unavailable")
		return 1
	}
	defer syscall.CloseHandle(parent)
	if result, _, _ := wait.Call(uintptr(parent), 0); result != 258 {
		return 1
	}
	job, _, _ := createJob.Call(0, 0)
	if job == 0 {
		fmt.Fprintln(os.Stderr, "jobhost: cannot create job object")
		return 1
	}
	defer syscall.CloseHandle(syscall.Handle(job))
	limits := extendedLimits{}
	limits.Basic.Flags = 0x2000 // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if result, _, _ := setJob.Call(job, 9, uintptr(unsafe.Pointer(&limits)), unsafe.Sizeof(limits)); result == 0 {
		fmt.Fprintln(os.Stderr, "jobhost: cannot set process lifetime limit")
		return 1
	}
	child := exec.Command(os.Args[2], os.Args[3:]...)
	child.Stdin = os.Stdin
	child.Stdout = os.Stdout
	child.Stderr = os.Stderr
	if err := child.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "jobhost: cannot launch core")
		return 1
	}
	handle, err := syscall.OpenProcess(0x0100|0x0001, false, uint32(child.Process.Pid))
	if err != nil {
		child.Process.Kill()
		child.Wait()
		return 1
	}
	result, _, _ := assignJob.Call(job, uintptr(handle))
	syscall.CloseHandle(handle)
	if result == 0 {
		child.Process.Kill()
		child.Wait()
		fmt.Fprintln(os.Stderr, "jobhost: cannot contain core process")
		return 1
	}
	stopped := make(chan struct{})
	go func() {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopped:
				return
			case <-ticker.C:
				result, _, _ := wait.Call(uintptr(parent), 0)
				if result != 258 {
					child.Process.Kill()
					return
				}
			}
		}
	}()
	err = child.Wait()
	close(stopped)
	if err != nil {
		if child.ProcessState != nil {
			return child.ProcessState.ExitCode()
		}
		return 1
	}
	return 0
}
func main() { os.Exit(run()) }
