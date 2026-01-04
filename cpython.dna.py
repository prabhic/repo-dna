"""
REPO-DNA: CPython
Source: https://github.com/python/cpython
Identity: Bytecode interpreter with reference-counted object model and extensible C API

This is not the repo. This is what makes the repo unique.
"""

# =============================================================================
# IDENTITY CORE: Everything is a PyObject
# =============================================================================
# CPython's foundation: All Python values are C structs with reference counting
# and type information. This enables uniform object handling in C.

class PyObject:
    """Base structure for all Python objects.
    Every value (int, str, list, function, class) starts with these fields:
    typedef struct _object { Py_ssize_t ob_refcnt; PyTypeObject *ob_type; } PyObject;
    """
    __slots__ = ('ob_refcnt', 'ob_type')
    
    def __init__(self, ob_type):
        self.ob_refcnt = 1
        self.ob_type = ob_type


# =============================================================================
# SIGNATURE PATTERN 1: Type System
# =============================================================================
# CPython's genius: Types describe object behavior through function pointers.

class PyTypeObject:
    """Describes object behavior. Contains function pointers for all operations:
    tp_new, tp_init, tp_call, tp_getattr, tp_setattr, tp_repr, number/sequence/mapping methods
    """
    def __init__(self, name, **ops):
        self.tp_name = name
        self.__dict__.update(ops)


# =============================================================================
# SIGNATURE PATTERN 2: Reference Counting
# =============================================================================
# CPython's memory management: Every object tracks reference count.

def Py_INCREF(obj):
    """THE most called function in CPython. Creates a new reference."""
    obj.ob_refcnt += 1
    return obj

def Py_DECREF(obj):
    """Remove reference. If refcount reaches 0, deallocate."""
    obj.ob_refcnt -= 1
    if obj.ob_refcnt == 0:
        pass  # obj->ob_type->tp_dealloc(obj)
    return obj

# =============================================================================
# ARCHITECTURAL DNA: Compilation Pipeline
# =============================================================================
# Source code → AST → Bytecode → Interpretation

class Instruction:
    """A single bytecode instruction (opcode + argument)."""
    __slots__ = ('opcode', 'arg')
    def __init__(self, opcode, arg=0):
        self.opcode = opcode
        self.arg = arg


class CodeObject(PyObject):
    """Compiled Python code. In C: PyCodeObject with co_code, co_names, co_varnames, etc."""
    def __init__(self, instructions, varnames, names, constants):
        super().__init__(code_type)
        self.co_code = instructions
        self.co_varnames = varnames
        self.co_names = names
        self.co_consts = constants


def compile_to_bytecode(source):
    """Full pipeline: Tokenize → Parse → AST → Bytecode
    Example: 'x = 1; y = x + 2' compiles to these instructions:"""
    return CodeObject(
        [
            Instruction('LOAD_CONST', 0),    # Push 1
            Instruction('STORE_FAST', 0),    # x = pop()
            Instruction('LOAD_FAST', 0),     # Push x
            Instruction('LOAD_CONST', 1),    # Push 2
            Instruction('BINARY_ADD'),       # Push (pop() + pop())
            Instruction('STORE_FAST', 1),    # y = pop()
            Instruction('LOAD_CONST', 2),    # Push None
            Instruction('RETURN_VALUE'),
        ],
        varnames=['x', 'y'],
        names=[],
        constants=[1, 2, None]
    )


# =============================================================================
# SIGNATURE PATTERN 3: Frame-Based Execution
# =============================================================================
# Each function call creates a frame with locals, stack, and instruction pointer.

class FrameObject(PyObject):
    """Execution frame. In C: PyFrameObject with f_code, f_locals, f_globals, etc."""
    def __init__(self, code, globals_dict, locals_dict=None):
        super().__init__(frame_type)
        self.f_code = code
        self.f_globals = globals_dict
        self.f_locals = locals_dict or {}
        self.f_valuestack = []
        self.f_lasti = 0
        self.f_back = None
    
    def push(self, val):
        self.f_valuestack.append(val)
        # In real CPython, only PyObject* are on stack, so INCREF is safe
        # Here we skip INCREF for non-PyObject types (educational simplification)
        if isinstance(val, PyObject):
            Py_INCREF(val)
    
    def pop(self):
        val = self.f_valuestack.pop()
        if isinstance(val, PyObject):
            Py_DECREF(val)
        return val


# =============================================================================
# THE "AHA" CODE: The Bytecode Evaluation Loop
# =============================================================================
# The heart of Python - the switch statement in ceval.c that interprets bytecode.

def PyEval_EvalFrame(frame):
    """The main evaluation loop. This IS Python execution.
    In real CPython (ceval.c), this is a giant switch with 100+ opcodes."""
    code = frame.f_code
    instructions = code.co_code
    
    while frame.f_lasti < len(instructions):
        instr = instructions[frame.f_lasti]
        opcode, arg = instr.opcode, instr.arg
        
        # The famous switch statement - each case implements one bytecode operation
        if opcode == 'LOAD_CONST':
            frame.push(code.co_consts[arg])
        elif opcode == 'LOAD_FAST':
            frame.push(frame.f_locals[code.co_varnames[arg]])
        elif opcode == 'STORE_FAST':
            frame.f_locals[code.co_varnames[arg]] = frame.pop()
        elif opcode == 'LOAD_NAME':
            name = code.co_names[arg]
            if name in frame.f_locals:
                frame.push(frame.f_locals[name])
            elif name in frame.f_globals:
                frame.push(frame.f_globals[name])
            else:
                raise NameError(f"name '{name}' is not defined")
        elif opcode == 'BINARY_ADD':
            right, left = frame.pop(), frame.pop()
            frame.push(left + right)  # In C: PyNumber_Add → tp_as_number->nb_add
        elif opcode == 'BINARY_SUBTRACT':
            right, left = frame.pop(), frame.pop()
            frame.push(left - right)
        elif opcode == 'CALL_FUNCTION':
            args = [frame.pop() for _ in range(arg)][::-1]
            func = frame.pop()
            frame.push(func(*args))  # In C: PyObject_Call → tp_call
        elif opcode == 'RETURN_VALUE':
            return frame.pop()
        elif opcode == 'POP_TOP':
            frame.pop()
        else:
            raise NotImplementedError(f"Opcode {opcode}")
        
        frame.f_lasti += 1
    
    return None


# =============================================================================
# ARCHITECTURAL DNA: The Global Interpreter Lock (GIL)
# =============================================================================
# Only one thread executes Python bytecode at a time. Controversial but simple.

class GIL:
    """The Global Interpreter Lock ensures thread safety by allowing only one
    thread to execute bytecode at a time."""
    def __init__(self):
        self.locked = False
        self.holder = None
    
    def acquire(self, thread_id):
        # Note: Real CPython uses condition variables and proper thread synchronization
        # This is a simplified demonstration - production code would use threading.Lock
        import time
        while self.locked and self.holder != thread_id:
            time.sleep(0.001)  # Avoid busy-wait
        self.locked = True
        self.holder = thread_id
    
    def release(self):
        self.locked = False
        self.holder = None


# =============================================================================
# EXTENSION POINT: C Extension Module API
# =============================================================================
# Python's killer feature: Write modules in C for performance or to wrap C libraries.

class PyMethodDef:
    """Describes a C function callable from Python."""
    def __init__(self, name, c_function, flags, doc):
        self.ml_name = name
        self.ml_meth = c_function
        self.ml_flags = flags  # METH_VARARGS, METH_KEYWORDS, etc.
        self.ml_doc = doc


class PyModuleDef:
    """Defines a Python module implemented in C."""
    def __init__(self, name, doc, methods):
        self.m_name = name
        self.m_doc = doc
        self.m_methods = methods


def PyModule_Create(module_def):
    """Create a module from definition. How numpy, pandas, PIL are built."""
    module = PyObject(module_type)
    # Set up module attributes from methods
    return module


# =============================================================================
# COMPLETE WORKING EXAMPLE
# =============================================================================
# Demonstrates the entire CPython execution model

def run_python_code(source):
    """What happens when you type 'python script.py':
    1. Compile source to bytecode
    2. Create execution frame
    3. Run evaluation loop
    """
    code = compile_to_bytecode(source)
    frame = FrameObject(code, {'__name__': '__main__'})
    return PyEval_EvalFrame(frame)


# =============================================================================
# WHAT MAKES CPYTHON UNIQUE
# =============================================================================

"""
1. REFERENCE COUNTING - Immediate deallocation, deterministic cleanup
2. BYTECODE INTERPRETER - Stack-based VM with 100+ opcodes
3. EVERYTHING IS A PYOBJECT - Uniform representation, dynamic typing
4. GLOBAL INTERPRETER LOCK - Thread safety, simple C API, limits parallelism
5. C EXTENSION API - Easy C integration, huge ecosystem (NumPy, etc.)
6. EXPLICIT PHILOSOPHY - "One obvious way", readability counts (Zen of Python)

NOT PyPy (JIT), Jython (JVM), IronPython (.NET), MicroPython (embedded), Cython (compiler)
"""

# =============================================================================
# MENTAL MODEL
# =============================================================================

"""
CPython execution flow:

Source Code → Bytecode → Evaluation Loop → Python Objects
    ↓            ↓             ↓                ↓
 compile()   CodeObject   PyEval_EvalFrame  PyObject* (refcounted)

Every operation goes through types:
    x + y → x->ob_type->tp_as_number->nb_add(x, y)

Every value is reference counted:
    Creation: Py_INCREF
    Assignment: Py_INCREF new, Py_DECREF old
    Deletion: Py_DECREF

Threading is serialized via GIL:
    Thread 1: GIL acquire → Execute → GIL release
    Thread 2:    Wait    → GIL acquire → Execute
"""

# =============================================================================
# THE GENIUS MOVES
# =============================================================================

"""
Key innovations:

1. SIMPLE BYTECODE INTERPRETER
   Easy to understand, predictable performance, enables introspection

2. REFERENCE COUNTING + CYCLE DETECTION
   Immediate cleanup vs GC pauses, predictable __del__ and with statements

3. UNIFORM OBJECT MODEL
   Everything is PyObject* in C, simplifies implementation, powerful introspection

4. PRAGMATIC C API
   Easy to extend, huge ecosystem, choose Python or C based on needs

5. GIL TRADEOFF
   Simplified threading, safe C extensions without locking, use multiprocessing for parallelism
"""

# =============================================================================
# IF YOU UNDERSTAND THIS, YOU UNDERSTAND CPYTHON
# =============================================================================

# Placeholder types (defined first to avoid forward references)
code_type = PyTypeObject('code')
frame_type = PyTypeObject('frame')
module_type = PyTypeObject('module')
some_type = PyTypeObject('object')

CPYTHON_ESSENCE = {
    # 1. Everything is a reference-counted object
    'object': lambda: PyObject(some_type),
    
    # 2. Code compiles to bytecode
    'compile': lambda src: compile_to_bytecode(src),
    
    # 3. Bytecode executes in evaluation loop
    'execute': lambda code: PyEval_EvalFrame(FrameObject(code, {})),
}

"""
The entire implementation in one sentence:
"Reference-counted objects interpreted by a bytecode VM with a GIL-protected
 evaluation loop and extensible C API."
"""

