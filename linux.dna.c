/*
 * REPO-DNA: Linux Kernel
 * Source: https://github.com/torvalds/linux
 * Identity: Monolithic Unix-like kernel with loadable modules, preemptive multitasking,
 *           and hardware abstraction through device drivers
 * 
 * This is not the repo. This is what makes the repo unique.
 * 
 * NOTE: This DNA exceeds the typical 500-line constraint due to the kernel's
 * complexity and the need to capture multiple critical subsystems.
 */

#include <linux/types.h>
#include <linux/list.h>
#include <linux/spinlock.h>
#include <linux/sched.h>
#include <linux/fs.h>
#include <linux/mm.h>
#include <asm/system.h>

// =============================================================================
// IDENTITY CORE: Everything is a File Descriptor or Kernel Object
// =============================================================================
// Linux's Unix heritage: Unified interface through file descriptors and
// everything exposed via the Virtual File System (VFS)

// The fundamental file operations structure - how the kernel talks to everything
struct file_operations {
    struct module *owner;
    loff_t (*llseek) (struct file *, loff_t, int);
    ssize_t (*read) (struct file *, char __user *, size_t, loff_t *);
    ssize_t (*write) (struct file *, const char __user *, size_t, loff_t *);
    int (*open) (struct inode *, struct file *);
    int (*release) (struct inode *, struct file *);
    int (*ioctl) (struct inode *, struct file *, unsigned int, unsigned long);
    int (*mmap) (struct file *, struct vm_area_struct *);
    int (*flush) (struct file *, fl_owner_t id);
    int (*fsync) (struct file *, int datasync);
    // ... and many more operations
};

// =============================================================================
// SIGNATURE PATTERN 1: The Task Structure (Process Descriptor)
// =============================================================================
// The heart of Linux: Every process is represented by task_struct

struct task_struct {
    volatile long state;           // TASK_RUNNING, TASK_INTERRUPTIBLE, etc.
    void *stack;                   // Kernel stack pointer
    unsigned int flags;            // PF_EXITING, PF_FORKNOEXEC, etc.
    int prio, static_prio, normal_prio; // Scheduling priorities
    
    // Process identification
    pid_t pid;
    pid_t tgid;                    // Thread group ID
    
    // Process relationships
    struct task_struct *parent;    // Parent process
    struct list_head children;     // List of child processes
    struct list_head sibling;      // Sibling processes
    
    // Scheduling
    struct sched_entity se;        // Completely Fair Scheduler entity
    struct sched_rt_entity rt;     // Real-time scheduling entity
    unsigned int policy;           // SCHED_NORMAL, SCHED_FIFO, SCHED_RR
    cpumask_t cpus_allowed;        // CPU affinity mask
    
    // Memory management
    struct mm_struct *mm;          // Process memory descriptor
    struct mm_struct *active_mm;   // Active address space
    
    // File system
    struct fs_struct *fs;          // File system info (root, pwd)
    struct files_struct *files;    // Open file descriptors
    
    // Signal handling
    struct signal_struct *signal;
    struct sighand_struct *sighand;
    sigset_t blocked, real_blocked;
    struct sigpending pending;
    
    // Kernel stack and CPU context
    struct thread_struct thread;   // CPU-specific state
    
    // Credentials
    const struct cred *cred;       // Effective credentials
    uid_t uid, euid, suid, fsuid;  // User IDs
    gid_t gid, egid, sgid, fsgid;  // Group IDs
    
    // Time and resource usage
    u64 utime, stime;              // User/System CPU time
    struct task_cputime cputime_expires;
    
    // Namespaces (containers!)
    struct nsproxy *nsproxy;
};

// =============================================================================
// SIGNATURE PATTERN 2: System Call Interface
// =============================================================================
// How userspace talks to the kernel - the system call table

// System call handler macro
#define SYSCALL_DEFINE3(name, type1, arg1, type2, arg2, type3, arg3) \
    asmlinkage long sys_##name(type1 arg1, type2 arg2, type3 arg3)

// Example: The read() system call - one of the most fundamental
SYSCALL_DEFINE3(read, unsigned int, fd, char __user *, buf, size_t, count)
{
    struct fd f = fdget_pos(fd);
    ssize_t ret = -EBADF;
    
    if (f.file) {
        loff_t pos = file_pos_read(f.file);
        ret = vfs_read(f.file, buf, count, &pos);
        if (ret >= 0)
            file_pos_write(f.file, pos);
        fdput_pos(f);
    }
    return ret;
}

// The actual VFS read implementation
ssize_t vfs_read(struct file *file, char __user *buf, size_t count, loff_t *pos)
{
    ssize_t ret;
    
    if (!(file->f_mode & FMODE_READ))
        return -EBADF;
    if (!file->f_op->read && !file->f_op->read_iter)
        return -EINVAL;
    if (unlikely(!access_ok(buf, count)))
        return -EFAULT;
    
    ret = rw_verify_area(READ, file, pos, count);
    if (ret >= 0) {
        count = ret;
        if (file->f_op->read)
            ret = file->f_op->read(file, buf, count, pos);
        else
            ret = new_sync_read(file, buf, count, pos);
        if (ret > 0) {
            fsnotify_access(file);
            add_rchar(current, ret);
        }
        inc_syscr(current);
    }
    return ret;
}

// =============================================================================
// ARCHITECTURAL DNA: The Completely Fair Scheduler (CFS)
// =============================================================================
// Linux's innovative approach to process scheduling using a red-black tree

struct sched_entity {
    struct load_weight load;       // For load balancing
    struct rb_node run_node;       // Red-black tree node
    struct list_head group_node;
    unsigned int on_rq;
    
    u64 exec_start;                // Time when started running
    u64 sum_exec_runtime;          // Total time spent running
    u64 vruntime;                  // Virtual runtime (the key!)
    u64 prev_sum_exec_runtime;
    
    u64 nr_migrations;
    struct sched_statistics statistics;
};

// The CFS runqueue per CPU
struct cfs_rq {
    struct load_weight load;
    unsigned long nr_running;
    
    u64 exec_clock;
    u64 min_vruntime;              // Minimum vruntime in the tree
    
    struct rb_root tasks_timeline; // Red-black tree of tasks
    struct rb_node *rb_leftmost;   // Cached leftmost node (next to run)
    
    struct sched_entity *curr, *next, *last, *skip;
};

// Pick the next task to run - the genius of CFS
static struct sched_entity *pick_next_entity(struct cfs_rq *cfs_rq)
{
    // Simply return the leftmost node (smallest vruntime)
    struct rb_node *left = cfs_rq->rb_leftmost;
    
    if (!left)
        return NULL;
    
    return rb_entry(left, struct sched_entity, run_node);
}

// Update a task's virtual runtime
static void update_curr(struct cfs_rq *cfs_rq)
{
    struct sched_entity *curr = cfs_rq->curr;
    u64 now = rq_clock_task(rq_of(cfs_rq));
    u64 delta_exec;
    
    if (unlikely(!curr))
        return;
    
    delta_exec = now - curr->exec_start;
    if (unlikely((s64)delta_exec <= 0))
        return;
    
    curr->exec_start = now;
    curr->sum_exec_runtime += delta_exec;
    
    // THE KEY: Convert real time to virtual time based on weight
    curr->vruntime += calc_delta_fair(delta_exec, curr);
    update_min_vruntime(cfs_rq);
}

// =============================================================================
// ARCHITECTURAL DNA: Memory Management - Page Tables and VMAs
// =============================================================================
// How Linux manages process memory

struct mm_struct {
    struct vm_area_struct *mmap;   // List of VMAs
    struct rb_root mm_rb;          // Red-black tree of VMAs
    
    pgd_t *pgd;                    // Page Global Directory (top-level page table)
    
    unsigned long start_code, end_code;      // Code segment
    unsigned long start_data, end_data;      // Data segment
    unsigned long start_brk, brk;            // Heap
    unsigned long start_stack;               // Stack
    unsigned long arg_start, arg_end;        // Command line arguments
    unsigned long env_start, env_end;        // Environment variables
    
    unsigned long total_vm;        // Total mapped pages
    unsigned long locked_vm;       // Locked pages (mlock)
    unsigned long pinned_vm;       // Pinned pages
    unsigned long data_vm;         // Data segment pages
    unsigned long exec_vm;         // Executable pages
    unsigned long stack_vm;        // Stack pages
    
    atomic_long_t nr_ptes;         // Page table pages
    spinlock_t page_table_lock;    // Protects page tables
};

// Virtual Memory Area - a contiguous range of virtual addresses
struct vm_area_struct {
    unsigned long vm_start;        // Start address
    unsigned long vm_end;          // End address (first byte after)
    
    struct vm_area_struct *vm_next, *vm_prev;
    struct rb_node vm_rb;          // Red-black tree node
    
    struct mm_struct *vm_mm;       // Back pointer to mm_struct
    pgprot_t vm_page_prot;         // Access permissions
    unsigned long vm_flags;        // VM_READ, VM_WRITE, VM_EXEC, etc.
    
    struct file *vm_file;          // File we're mapped to (or NULL)
    unsigned long vm_pgoff;        // Offset in file (in PAGE_SIZE units)
    
    const struct vm_operations_struct *vm_ops;
};

// Page fault handler - the "aha" moment for memory management
vm_fault_t do_page_fault(struct pt_regs *regs, unsigned long address,
                         unsigned long error_code)
{
    struct task_struct *tsk = current;
    struct mm_struct *mm = tsk->mm;
    struct vm_area_struct *vma;
    vm_fault_t fault;
    unsigned int flags = FAULT_FLAG_DEFAULT;
    
    // Find the VMA containing the faulting address
    vma = find_vma(mm, address);
    if (unlikely(!vma || vma->vm_start > address))
        goto bad_area;
    
    // Check permissions
    if (error_code & X86_PF_WRITE) {
        if (!(vma->vm_flags & VM_WRITE))
            goto bad_area;
        flags |= FAULT_FLAG_WRITE;
    } else if (error_code & X86_PF_INSTR) {
        if (!(vma->vm_flags & VM_EXEC))
            goto bad_area;
        flags |= FAULT_FLAG_INSTRUCTION;
    }
    
    // Handle the fault (allocate page, copy-on-write, etc.)
    fault = handle_mm_fault(vma, address, flags);
    
    return fault;
    
bad_area:
    // Segmentation fault!
    return VM_FAULT_SIGSEGV;
}

// =============================================================================
// SIGNATURE PATTERN 3: The VFS Layer
// =============================================================================
// The Virtual File System - abstraction over all file systems

struct inode {
    umode_t i_mode;                // File type and permissions
    unsigned short i_opflags;
    kuid_t i_uid;                  // Owner
    kgid_t i_gid;                  // Group
    unsigned int i_flags;
    
    const struct inode_operations *i_op;
    struct super_block *i_sb;
    struct address_space *i_mapping;
    
    unsigned long i_ino;           // Inode number
    union {
        const unsigned int i_nlink;
        unsigned int __i_nlink;
    };
    dev_t i_rdev;                  // Device number (if special file)
    loff_t i_size;                 // File size in bytes
    struct timespec64 i_atime;     // Access time
    struct timespec64 i_mtime;     // Modification time
    struct timespec64 i_ctime;     // Change time
    
    blkcnt_t i_blocks;             // Number of blocks
    unsigned short i_bytes;
    
    spinlock_t i_lock;
    
    const struct file_operations *i_fop;
    struct address_space i_data;   // Page cache
    struct list_head i_devices;    // For block/char devices
};

struct dentry {
    unsigned int d_flags;          // DCACHE_* flags
    seqcount_t d_seq;
    struct hlist_bl_node d_hash;   // Hash list
    struct dentry *d_parent;       // Parent directory
    struct qstr d_name;            // File name
    struct inode *d_inode;         // Associated inode
    
    unsigned char d_iname[DNAME_INLINE_LEN]; // Short name storage
    
    struct lockref d_lockref;      // Lock and reference count
    const struct dentry_operations *d_op;
    struct super_block *d_sb;
    
    union {
        struct list_head d_lru;    // LRU list
        wait_queue_head_t *d_wait;
    };
    struct list_head d_child;      // In parent's d_subdirs list
    struct list_head d_subdirs;    // Our children
    struct hlist_node d_alias;     // Inode alias list
};

// Path lookup - how "open('/home/user/file.txt')" works
struct dentry *path_lookup(const char *pathname, unsigned int flags)
{
    struct path path;
    struct dentry *dentry;
    int error;
    
    // Start from root or current directory
    if (pathname[0] == '/') {
        path.dentry = current->fs->root.dentry;
        path.mnt = current->fs->root.mnt;
    } else {
        path.dentry = current->fs->pwd.dentry;
        path.mnt = current->fs->pwd.mnt;
    }
    
    // Walk the path component by component
    const char *name = pathname;
    while (*name) {
        // Find next component
        const char *slash = strchr(name, '/');
        int len = slash ? slash - name : strlen(name);
        
        // Lookup in current directory
        dentry = d_lookup(path.dentry, name, len);
        if (!dentry) {
            // Not in cache, ask file system
            dentry = path.dentry->d_inode->i_op->lookup(
                path.dentry->d_inode, dentry, flags);
        }
        
        path.dentry = dentry;
        name = slash ? slash + 1 : name + len;
    }
    
    return path.dentry;
}

// =============================================================================
// ARCHITECTURAL DNA: Kernel Modules
// =============================================================================
// Linux's modularity - loadable kernel modules

struct module {
    enum module_state state;       // MODULE_STATE_LIVE, etc.
    struct list_head list;         // Member of global modules list
    char name[MODULE_NAME_LEN];    // Module name
    
    // Module parameters
    struct kernel_param *kp;
    unsigned int num_kp;
    
    // Symbols exported by this module
    const struct kernel_symbol *syms;
    const unsigned long *crcs;
    unsigned int num_syms;
    
    // Module's own symbol table
    struct kernel_symbol *gpl_syms;
    const unsigned long *gpl_crcs;
    unsigned int num_gpl_syms;
    
    // Module initialization and cleanup
    int (*init)(void);
    void (*exit)(void);
    
    // Core layout (memory regions)
    struct module_layout core_layout;
    struct module_layout init_layout;
};

// Example: A simple character device driver module
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>
#include <linux/cdev.h>

static int device_open(struct inode *inode, struct file *file)
{
    printk(KERN_INFO "Device opened\n");
    return 0;
}

static ssize_t device_read(struct file *filp, char __user *buffer,
                          size_t length, loff_t *offset)
{
    return 0; // EOF
}

static struct file_operations fops = {
    .read = device_read,
    .open = device_open,
};

static int __init my_driver_init(void)
{
    printk(KERN_INFO "Hello, kernel!\n");
    // Register character device
    register_chrdev(MAJOR_NUM, DEVICE_NAME, &fops);
    return 0;
}

static void __exit my_driver_exit(void)
{
    printk(KERN_INFO "Goodbye, kernel!\n");
    unregister_chrdev(MAJOR_NUM, DEVICE_NAME);
}

module_init(my_driver_init);
module_exit(my_driver_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Linus Torvalds");
MODULE_DESCRIPTION("Example driver showing kernel module pattern");

// =============================================================================
// SIGNATURE PATTERN 4: Linked Lists (The Kernel's Data Structure)
// =============================================================================
// Linux's elegant intrusive linked list - used everywhere

struct list_head {
    struct list_head *next, *prev;
};

#define LIST_HEAD_INIT(name) { &(name), &(name) }

static inline void INIT_LIST_HEAD(struct list_head *list)
{
    list->next = list;
    list->prev = list;
}

static inline void __list_add(struct list_head *new,
                             struct list_head *prev,
                             struct list_head *next)
{
    next->prev = new;
    new->next = next;
    new->prev = prev;
    prev->next = new;
}

static inline void list_add(struct list_head *new, struct list_head *head)
{
    __list_add(new, head, head->next);
}

// The magic: container_of macro
#define offsetof(TYPE, MEMBER) ((size_t) &((TYPE *)0)->MEMBER)

#define container_of(ptr, type, member) ({                     \
    const typeof(((type *)0)->member) *__mptr = (ptr);        \
    (type *)((char *)__mptr - offsetof(type, member)); })

// Usage example:
// struct task_struct *task = container_of(list_ptr, struct task_struct, children);

#define list_entry(ptr, type, member) \
    container_of(ptr, type, member)

#define list_for_each_entry(pos, head, member)                 \
    for (pos = list_entry((head)->next, typeof(*pos), member); \
         &pos->member != (head);                               \
         pos = list_entry(pos->member.next, typeof(*pos), member))

// =============================================================================
// ARCHITECTURAL DNA: Interrupt Handling
// =============================================================================
// How the kernel responds to hardware events

struct irq_desc {
    struct irq_data irq_data;
    irq_flow_handler_t handle_irq;
    struct irqaction *action;      // Linked list of handlers
    unsigned int status_use_accessors;
    unsigned int core_internal_state__do_not_mess_with_it;
    unsigned int depth;            // Disable depth
    unsigned int wake_depth;
    unsigned int irq_count;        // Stats
    unsigned long last_unhandled;
    spinlock_t lock;
    struct cpumask *affinity_hint;
    const char *name;
};

// Interrupt handler function type
typedef irqreturn_t (*irq_handler_t)(int, void *);

struct irqaction {
    irq_handler_t handler;         // The actual handler function
    void *dev_id;                  // Device identifier
    struct irqaction *next;        // Next handler in chain
    unsigned int flags;            // IRQF_SHARED, etc.
    const char *name;              // Device name
};

// Request an interrupt line
int request_irq(unsigned int irq, irq_handler_t handler,
               unsigned long flags, const char *name, void *dev)
{
    struct irqaction *action;
    struct irq_desc *desc;
    int ret;
    
    // Allocate action structure
    action = kzalloc(sizeof(struct irqaction), GFP_KERNEL);
    if (!action)
        return -ENOMEM;
    
    action->handler = handler;
    action->flags = flags;
    action->name = name;
    action->dev_id = dev;
    
    // Get IRQ descriptor
    desc = irq_to_desc(irq);
    
    // Add to handler chain
    ret = __setup_irq(irq, desc, action);
    
    return ret;
}

// Top-half: Interrupt handler (runs with interrupts disabled)
irqreturn_t my_interrupt_handler(int irq, void *dev_id)
{
    // Quick critical work
    // ACK the interrupt
    // Schedule bottom-half if needed
    schedule_work(&my_work);
    
    return IRQ_HANDLED;
}

// Bottom-half: Deferred work (runs with interrupts enabled)
void my_work_handler(struct work_struct *work)
{
    // Longer processing that can be interrupted
}

// =============================================================================
// ARCHITECTURAL DNA: Locking Primitives
// =============================================================================
// How the kernel handles concurrency

// Spinlock: Busy-wait lock for short critical sections
typedef struct {
    arch_spinlock_t raw_lock;
} spinlock_t;

static inline void spin_lock(spinlock_t *lock)
{
    // Disable preemption
    preempt_disable();
    // Acquire lock (busy wait)
    while (test_and_set(&lock->raw_lock))
        cpu_relax();
}

static inline void spin_unlock(spinlock_t *lock)
{
    // Release lock
    lock->raw_lock = 0;
    // Enable preemption
    preempt_enable();
}

// Mutex: Sleep lock for longer critical sections
struct mutex {
    atomic_long_t owner;
    spinlock_t wait_lock;
    struct list_head wait_list;
};

void mutex_lock(struct mutex *lock)
{
    // Try to acquire quickly
    if (likely(atomic_cmpxchg_acquire(&lock->owner, 0, current) == 0))
        return;
    
    // Slow path: Add to wait queue and sleep
    __mutex_lock_slowpath(lock);
}

// Read-Copy-Update (RCU): Lock-free reading
struct rcu_head {
    struct rcu_head *next;
    void (*func)(struct rcu_head *head);
};

void call_rcu(struct rcu_head *head, void (*func)(struct rcu_head *head))
{
    // Schedule callback after grace period
    head->func = func;
    __call_rcu(head);
}

// RCU read-side critical section (no overhead!)
#define rcu_read_lock()  preempt_disable()
#define rcu_read_unlock() preempt_enable()

// =============================================================================
// SIGNATURE PATTERN 5: Device Drivers and Subsystems
// =============================================================================
// How the kernel abstracts hardware

struct device {
    struct device *parent;
    struct device_private *p;
    struct kobject kobj;
    const char *init_name;
    const struct device_type *type;
    
    struct bus_type *bus;          // Type of bus device is on
    struct device_driver *driver;   // Allocated driver
    void *platform_data;
    void *driver_data;
    
    struct dev_pm_info power;      // Power management
    u64 *dma_mask;                 // DMA addressing limitations
    
    struct list_head dma_pools;
    struct dma_coherent_mem *dma_mem;
    
    struct dev_archdata archdata;  // Arch-specific data
};

struct device_driver {
    const char *name;
    struct bus_type *bus;
    
    struct module *owner;
    const char *mod_name;
    
    int (*probe)(struct device *dev);
    int (*remove)(struct device *dev);
    void (*shutdown)(struct device *dev);
    int (*suspend)(struct device *dev, pm_message_t state);
    int (*resume)(struct device *dev);
};

// Example: Network device driver structure
struct net_device {
    char name[IFNAMSIZ];           // Device name (eth0, wlan0, etc.)
    
    unsigned long state;
    
    const struct net_device_ops *netdev_ops;
    const struct ethtool_ops *ethtool_ops;
    
    unsigned int flags;            // IFF_UP, IFF_BROADCAST, etc.
    unsigned int priv_flags;
    
    unsigned short type;           // Hardware type (Ethernet, etc.)
    unsigned short hard_header_len;
    unsigned short needed_headroom;
    unsigned short needed_tailroom;
    
    unsigned char addr_len;        // Hardware address length
    unsigned char *dev_addr;       // Hardware address
    
    struct netdev_queue *_tx;      // Transmit queue
    unsigned int num_tx_queues;
    unsigned int real_num_tx_queues;
    
    struct Qdisc *qdisc;           // Queuing discipline
    
    unsigned long tx_queue_len;    // TX queue length
    spinlock_t tx_global_lock;
    
    // Statistics
    struct net_device_stats stats;
};

struct net_device_ops {
    int (*ndo_init)(struct net_device *dev);
    void (*ndo_uninit)(struct net_device *dev);
    int (*ndo_open)(struct net_device *dev);
    int (*ndo_stop)(struct net_device *dev);
    netdev_tx_t (*ndo_start_xmit)(struct sk_buff *skb, struct net_device *dev);
    void (*ndo_set_rx_mode)(struct net_device *dev);
    int (*ndo_set_mac_address)(struct net_device *dev, void *addr);
    int (*ndo_do_ioctl)(struct net_device *dev, struct ifreq *ifr, int cmd);
    // ... many more operations
};

// =============================================================================
// THE "AHA" CODE: Context Switch
// =============================================================================
// The fundamental operation of a multitasking kernel

asmlinkage __visible void __sched schedule(void)
{
    struct task_struct *prev, *next;
    struct rq *rq;
    int cpu;
    
    // Disable preemption
    preempt_disable();
    
    // Get current CPU's run queue
    cpu = smp_processor_id();
    rq = cpu_rq(cpu);
    prev = rq->curr;
    
    // Update current task's runtime
    update_curr(rq->cfs);
    
    // Pick next task to run
    next = pick_next_task(rq, prev);
    
    // Same task? Nothing to do
    if (likely(prev == next))
        goto out;
    
    // Different task - perform context switch
    rq->curr = next;
    ++rq->nr_switches;
    
    // THE MAGIC: Switch to new task's address space and registers
    context_switch(rq, prev, next);
    
out:
    preempt_enable();
}

// The actual context switch - switch memory maps and CPU state
static __always_inline struct rq *
context_switch(struct rq *rq, struct task_struct *prev,
              struct task_struct *next)
{
    struct mm_struct *mm, *oldmm;
    
    // Switch memory context (page tables)
    mm = next->mm;
    oldmm = prev->active_mm;
    
    if (!mm) {
        // Kernel thread - borrow previous address space
        next->active_mm = oldmm;
        atomic_inc(&oldmm->mm_count);
    } else {
        // User thread - switch to new address space
        switch_mm(oldmm, mm, next);
    }
    
    // Switch CPU context (registers, stack pointer, etc.)
    switch_to(prev, next, prev);
    
    return finish_task_switch(prev);
}

// =============================================================================
// EXTENSION POINTS: How Linux Grows
// =============================================================================

// 1. Loadable Kernel Modules
//    - module_init() and module_exit() macros
//    - EXPORT_SYMBOL() to share functions with other modules
//    - Module parameters via module_param()

// 2. Device Driver Frameworks
//    - USB subsystem: struct usb_driver
//    - PCI subsystem: struct pci_driver
//    - Platform devices: struct platform_driver
//    - Character devices: struct cdev, file_operations
//    - Block devices: struct gendisk, block_device_operations
//    - Network devices: struct net_device, net_device_ops

// 3. File Systems
//    - struct file_system_type
//    - register_filesystem()
//    - Implement: mount, kill_sb, and file/inode operations

// 4. System Calls
//    - SYSCALL_DEFINE macros
//    - Add to arch-specific syscall table

// 5. Proc and Sysfs
//    - /proc for process information
//    - /sys for device and kernel subsystem info
//    - Create entries with proc_create() and sysfs_create_file()

// =============================================================================
// WHAT MAKES LINUX UNIQUE
// =============================================================================

/*
 * 1. MONOLITHIC WITH MODULES
 *    - Everything in one address space for performance
 *    - Yet extensible via loadable modules
 *    - Balance between microkernel flexibility and monolithic speed
 *
 * 2. COMPLETELY FAIR SCHEDULER (CFS)
 *    - O(log n) scheduling using red-black tree
 *    - Virtual runtime for fairness
 *    - No expired/active arrays like O(1) scheduler
 *
 * 3. VIRTUAL FILE SYSTEM (VFS)
 *    - Unified interface to all file systems
 *    - Everything is a file: devices, processes, network, etc.
 *    - Allows supporting 40+ different file systems
 *
 * 4. COPY-ON-WRITE (COW) EVERYWHERE
 *    - fork() doesn't copy pages immediately
 *    - mmap() with MAP_PRIVATE is COW
 *    - Massive performance win
 *
 * 5. SLAB ALLOCATOR
 *    - Object caching for frequently allocated structures
 *    - Reduces memory fragmentation
 *    - Per-CPU caches for lock-free allocation
 *
 * 6. READ-COPY-UPDATE (RCU)
 *    - Lock-free reading for scalability
 *    - Writers wait for grace period
 *    - Critical for SMP performance
 *
 * 7. NETWORK STACK
 *    - Socket buffers (sk_buff) with shared data
 *    - Zero-copy networking
 *    - Sophisticated queuing disciplines (QDisc)
 *
 * 8. DEVICE MODEL
 *    - Hierarchical device tree (sysfs)
 *    - Hot-plugging support (udev)
 *    - Power management framework
 *
 * NOT: Windows (hybrid kernel), macOS (Mach microkernel + BSD),
 *      FreeBSD (different architecture), QNX (microkernel)
 */

// =============================================================================
// MENTAL MODEL
// =============================================================================

/*
 * Linux Execution Flow:
 * 
 * User Space:      Application
 *                      |
 *                  system call (int 0x80 or syscall instruction)
 *                      ↓
 * Kernel Space:    System Call Handler
 *                      ↓
 *                  VFS Layer (if file I/O)
 *                      ↓
 *                  File System / Driver
 *                      ↓
 *                  Hardware
 * 
 * Memory Layout (x86_64):
 * 0x0000000000000000 - 0x00007FFFFFFFFFFF : User space (128 TB)
 * 0xFFFF800000000000 - 0xFFFFFFFFFFFFFFFF : Kernel space (128 TB)
 * 
 * Task State Flow:
 * TASK_RUNNING → TASK_INTERRUPTIBLE → (wake_up) → TASK_RUNNING
 *             ↘ TASK_UNINTERRUPTIBLE ↗
 *             ↘ TASK_STOPPED
 *             ↘ TASK_ZOMBIE → (wait) → EXIT_DEAD
 * 
 * Page Fault Flow:
 * CPU access → MMU → Page fault → do_page_fault() → handle_mm_fault() →
 * → __handle_mm_fault() → handle_pte_fault() → do_anonymous_page() or
 *   do_fault() or do_wp_page() → alloc_page() → update page tables
 */

// =============================================================================
// THE GENIUS MOVES
// =============================================================================

/*
 * Key Innovations that Made Linux Dominant:
 * 
 * 1. DELAYED ALLOCATION
 *    fork() is fast because pages aren't copied until written
 *    
 * 2. UNIFIED PAGE CACHE
 *    One cache for file data, eliminates double-caching
 *    
 * 3. INTRUSIVE DATA STRUCTURES
 *    list_head embedded in objects, not separate allocations
 *    
 * 4. WORKQUEUES AND BOTTOM HALVES
 *    Split interrupt handling into immediate and deferred work
 *    
 * 5. NAMESPACES AND CGROUPS
 *    Foundation for containers (Docker, Kubernetes)
 *    Revolutionized deployment without full virtualization
 *    
 * 6. BTRFS/XFS/EXT4 COPY-ON-WRITE
 *    Snapshots, checksums, multi-device support
 *    
 * 7. NETFILTER/IPTABLES
 *    Powerful, flexible packet filtering
 *    Foundation for firewalls and NAT
 *    
 * 8. DMA AND ZERO-COPY
 *    sendfile(), splice() - avoid copying between kernel/user space
 */

// =============================================================================
// IF YOU UNDERSTAND THIS, YOU UNDERSTAND LINUX
// =============================================================================

struct linux_essence {
    // 1. Everything is either a process or a file
    struct task_struct *process;
    struct inode *file;
    
    // 2. Processes are scheduled fairly by virtual runtime
    struct cfs_rq *scheduler;
    
    // 3. Memory is managed through VMAs and page tables
    struct mm_struct *memory;
    
    // 4. I/O goes through the VFS layer
    struct file_operations *vfs;
    
    // 5. Extensibility through modules
    struct module *extension;
    
    // 6. Concurrency through various locking primitives
    spinlock_t *lock;
    struct mutex *mutex;
    struct rcu_head *rcu;
};

/*
 * The entire kernel in one sentence:
 * "A monolithic, preemptive, multitasking kernel with a unified VFS layer,
 *  fair scheduling, sophisticated memory management, and extensibility
 *  through loadable modules—all orchestrated by system calls and interrupts."
 */

// =============================================================================
// REAL-WORLD PATTERNS
// =============================================================================

// Pattern 1: Kernel Thread
int kernel_thread_fn(void *data)
{
    while (!kthread_should_stop()) {
        // Do work
        schedule_timeout_interruptible(HZ);
    }
    return 0;
}

struct task_struct *kthread = kthread_run(kernel_thread_fn, NULL, "my_kthread");

// Pattern 2: Wait Queue (sleeping for events)
DECLARE_WAIT_QUEUE_HEAD(my_wq);

void wait_for_event(void)
{
    wait_event_interruptible(my_wq, condition == true);
}

void signal_event(void)
{
    condition = true;
    wake_up_interruptible(&my_wq);
}

// Pattern 3: Per-CPU Variables (avoiding locks)
DEFINE_PER_CPU(int, cpu_counter);

void increment_counter(void)
{
    int cpu = get_cpu();  // Disable preemption
    per_cpu(cpu_counter, cpu)++;
    put_cpu();            // Enable preemption
}

// Pattern 4: Memory Barriers (SMP synchronization)
void producer(void)
{
    data = new_value;
    wmb();  // Write memory barrier
    flag = true;
}

void consumer(void)
{
    while (!flag)
        cpu_relax();
    rmb();  // Read memory barrier
    use(data);
}

// =============================================================================
// KERNEL BOOT SEQUENCE (The Big Picture)
// =============================================================================

/*
 * 1. BIOS/UEFI loads bootloader (GRUB)
 * 2. Bootloader loads kernel image and initrd into memory
 * 3. Bootloader jumps to kernel entry point
 * 4. start_kernel() - the kernel's main()
 *    - setup_arch() - architecture-specific setup
 *    - trap_init() - set up interrupt handlers
 *    - mm_init() - initialize memory management
 *    - sched_init() - initialize scheduler
 *    - time_init() - initialize timekeeping
 *    - console_init() - early console for debugging
 *    - init_IRQ() - initialize interrupt handling
 *    - softirq_init() - initialize bottom halves
 *    - rest_init() - create init process
 * 5. kernel_init() - mount root filesystem
 * 6. run_init_process() - exec /sbin/init (PID 1)
 * 7. Init starts user space (systemd, OpenRC, etc.)
 */

// =============================================================================
// THE DNA IN ACTION: A Complete System Call Flow
// =============================================================================

/*
 * Example: read(fd, buffer, count)
 * 
 * 1. User space calls read() from libc
 * 2. libc wrapper prepares syscall (number, args) and invokes syscall instruction
 * 3. CPU switches to kernel mode, jumps to system_call entry point
 * 4. Kernel saves user context on kernel stack
 * 5. System call dispatcher finds sys_read in syscall table
 * 6. sys_read validates fd and buffer
 * 7. sys_read calls vfs_read
 * 8. vfs_read calls file->f_op->read (file system specific)
 * 9. File system reads from page cache or disk
 * 10. Data copied to user buffer (copy_to_user)
 * 11. Return value placed in register
 * 12. Kernel restores user context
 * 13. CPU switches back to user mode
 * 14. User space continues with return value
 * 
 * All in microseconds!
 */
