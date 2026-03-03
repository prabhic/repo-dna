"""
REPO-DNA: classiq-library
Source: https://github.com/Classiq/classiq-library
Identity: High-level quantum functional programming—describe quantum intent once, synthesize to any hardware

This is not the repo. This is what makes the repo unique.
"""

# =============================================================================
# IDENTITY CORE: Separation of Quantum Intent from Physical Implementation
# =============================================================================
# Classiq's unique insight: quantum programs are high-level functional
# descriptions (Qmod) that are SYNTHESIZED—not compiled—into optimized gate
# sequences. You specify WHAT the circuit does; the synthesis engine decides
# HOW many qubits and which gates implement it, subject to hardware constraints.

from __future__ import annotations
from typing import TypeVar, Generic, Callable, List, Optional, Any
from dataclasses import dataclass
from math import pi

T = TypeVar('T')

# --------------- Quantum type system ----------------------------------------
class QBit: ...
class QNum: ...
class QArray(Generic[T]): ...
class Output(Generic[T]): ...      # variable allocated inside the function
QCallable = Callable               # quantum function as a first-class value
CArray = List                      # classical array type in Qmod
CReal = float                      # classical real parameter


# --------------- Classiq built-in primitives (stubs) ------------------------
def allocate(n, var): ...
def drop(var): ...
def X(q): ...
def H(q): ...
def RX(angle, q): ...
def RY(angle, q): ...
def hadamard_transform(reg): ...
def phase(angle, q): ...
def control(condition, body_fn): ...
def repeat(count, iteration_fn): ...
def apply_to_all(fn, reg): ...
def power(n, body_fn): ...
def qft_dagger(reg): ...
def prepare_amplitudes(vec, bound, out): ...
def unitary(matrix, reg): ...
def qpe(unitary_fn, phase_reg): ...
def grover_operator(oracle, state_prep, reg): ...
def phase_oracle(predicate, reg): ...


# =============================================================================
# SIGNATURE PATTERN 1: @qfunc — Python Functions as Quantum Specifications
# =============================================================================
# The @qfunc decorator is Classiq's foundation.
# Parameters are typed quantum variables. The body is a quantum specification
# that the synthesis engine processes—it is never executed as Python.

def qfunc(fn):
    fn._is_qfunc = True
    return fn


@qfunc
def main(res: Output[QBit]) -> None:
    allocate(1, res)
    X(res)


@qfunc
def prep_minus(out: Output[QBit]) -> None:
    allocate(1, out)
    X(out)
    H(out)


@qfunc
def angle_encoding(exe_params: CArray[CReal], qbv: Output[QArray[QBit]]) -> None:
    allocate(len(exe_params), qbv)
    repeat(
        len(exe_params),
        lambda index: RY(pi * exe_params[index], qbv[index]),
    )


# =============================================================================
# SIGNATURE PATTERN 2: within/apply — Automatic Quantum Uncomputation
# =============================================================================
# Classiq's most distinctive construct. Structure:
#
#   within { prepare_context() }
#   apply  { do_operation()    }
#
# Equivalent to: U_prepare → U_operation → U_prepare†
# The synthesis engine automatically inserts the inverse (†) of the within-block.
# This is how phase oracles achieve phase kickback without ancilla leakage.

class WithinApplyBuilder:
    """Builder for the within/apply uncomputation pattern."""
    def __init__(self, prepare_fn: Callable):
        self.prepare_fn = prepare_fn

    def apply(self, operation_fn: Callable) -> None:
        """
        Executes: prepare_fn() → operation_fn() → prepare_fn()†
        The synthesis engine inserts the automatically-generated inverse.
        """
        self.prepare_fn()
        operation_fn()
        # synthesis engine appends prepare_fn† (uncomputation) here


def within(prepare_fn: Callable) -> WithinApplyBuilder:
    return WithinApplyBuilder(prepare_fn)


@qfunc
def deutsch_jozsa(predicate: QCallable, x: QNum) -> None:
    within(lambda: hadamard_transform(x)).apply(
        lambda: phase_oracle(lambda x, y: predicate(x, y), x)
    )


@qfunc
def grover_diffusion(state_preparation: QCallable, x: QArray[QBit]) -> None:
    # Reflect about the initial state: U_prep |0⟩⟨0| U_prep†
    # within: apply state_preparation to create the initial state context
    # apply:  flip the phase of |0⟩ (the zero state in the prepared basis)
    # The synthesis engine automatically uncomputes state_preparation afterward
    zero_phase_flip = QBit()       # ancilla: marks the |0⟩ component
    within(lambda: state_preparation(x)).apply(
        lambda: control(zero_phase_flip, lambda: phase(pi)),  # phase on |0⟩ only
    )


# =============================================================================
# SIGNATURE PATTERN 3: Higher-Order Quantum Functions (QCallable)
# =============================================================================
# Quantum functions are first-class values. Algorithms like Grover and QPE
# accept oracle functions as QCallable parameters—making them reusable
# templates where any compatible @qfunc can be plugged in.

@qfunc
def mixer_layer(beta: CReal, qba: QArray[QBit]) -> None:
    apply_to_all(lambda q: RX(beta, q), qba)


@qfunc
def qaoa_ansatz(
    cost_layer: QCallable,   # any cost function as quantum argument
    gammas: CArray[CReal],
    betas: CArray[CReal],
    qba: QArray[QBit],
) -> None:
    repeat(len(betas), lambda i: (
        cost_layer(gammas[i], qba),
        mixer_layer(betas[i], qba),
    ))


@qfunc
def maxcut_cost_layer(gamma: CReal, v: QArray[QBit]) -> None:
    phase(
        (
              (v[0] * (1 - v[1]) + v[1] * (1 - v[0]))  # edge (0,1)
            + (v[1] * (1 - v[2]) + v[2] * (1 - v[1]))  # edge (1,2)
            + (v[2] * (1 - v[3]) + v[3] * (1 - v[2]))  # edge (2,3)
        ) / 3,
        gamma,
    )


# =============================================================================
# ARCHITECTURAL DNA: Model → Synthesize → Execute
# =============================================================================
# The Classiq pipeline is not a compiler—it is an optimizer.
# The synthesis engine searches for the circuit that satisfies constraints
# (qubit count, gate depth, basis gates) while preserving the functional spec.

@dataclass
class OptimizationConstraints:
    """Control the synthesis tradeoff: fewer qubits vs. shallower circuit."""
    optimization_parameter: str = 'cx'  # minimize CX gates
    max_width: Optional[int] = None     # hard limit on qubit count
    max_depth: Optional[int] = None     # hard limit on circuit depth


@dataclass
class QuantumProgram:
    """A synthesized, hardware-ready quantum circuit."""
    main_fn: Callable
    constraints: Optional[OptimizationConstraints] = None
    width: int = 0            # physical qubits allocated
    depth: int = 0            # gate layers (circuit depth)
    backend: str = 'simulator'


class ExecutionResult:
    def result_value(self):
        """Returns a pandas.DataFrame with columns: bitstring, count, probability."""
        ...


def synthesize(
    main_fn: Callable,
    constraints: Optional[OptimizationConstraints] = None,
) -> QuantumProgram:
    """
    THE central Classiq operation.
    @qfunc specification → optimized physical circuit.

    Synthesis steps:
    1. Resolve all @qfunc calls into a quantum IR graph
    2. Determine qubit allocation and reuse (ancilla recycling)
    3. Select gate decompositions for the target hardware basis
    4. Optimize width or depth per constraints
    """
    return QuantumProgram(main_fn, constraints)


def execute(
    program: QuantumProgram,
    backend: str = 'simulator',
) -> ExecutionResult:
    """Dispatch to IBM, Amazon Braket, Azure Quantum, Nvidia, or simulator."""
    program.backend = backend
    return ExecutionResult()


def show(program: QuantumProgram) -> None:
    """Open the synthesized circuit in the Classiq IDE for visual inspection."""
    ...


# =============================================================================
# EXTENSION POINT: @qfunc Library Functions as Pluggable Components
# =============================================================================
# Any @qfunc is automatically a composable building block.
# The extension seam is QCallable: pass your @qfunc into any algorithm template.

@qfunc
def generic_grover_operator(
    oracle: QCallable,             # pluggable: any phase-marking oracle
    state_preparation: QCallable,  # pluggable: any initial state prep
    x: QArray[QBit],
) -> None:
    oracle(x)
    grover_diffusion(state_preparation, x)


@qfunc
def generic_qpe(
    unitary_fn: QCallable,  # any unitary whose eigenphase we want
    phase_reg: QNum,
) -> None:
    hadamard_transform(phase_reg)
    repeat(
        phase_reg,
        lambda k: control(phase_reg, lambda: power(2**k, lambda: unitary_fn())),
    )
    qft_dagger(phase_reg)


# =============================================================================
# THE "AHA" CODE: Grover's Search via Functional Composition
# =============================================================================
# This is the moment of understanding: Grover's algorithm is a main() function
# that composes higher-order quantum functions. No qubit indexing, no gate
# matrices—just functional intent. The synthesis engine handles everything else.

@qfunc
def sat_oracle(x: QArray[QBit]) -> None:
    """User-defined oracle: marks states satisfying (x0 ∧ ¬x1) ∨ (¬x0 ∧ x1 ∧ x2).
    Bitwise operators map to Qmod's quantum control logic; the synthesis engine
    translates them into controlled-phase gates acting on the full register.
    """
    control(
        (x[0] & ~x[1]) | (~x[0] & x[1] & x[2]),  # Qmod Boolean expression
        lambda: phase(pi),  # flip phase on all satisfying states
    )


@qfunc
def main_grover(x: Output[QArray[QBit]]) -> None:
    allocate(3, x)
    hadamard_transform(x)
    power(2, lambda: generic_grover_operator(
        lambda q: sat_oracle(q),   # any oracle plugs in here
        hadamard_transform,         # any state prep plugs in here
        x,
    ))


# Synthesize with a qubit-count constraint, then execute:
program = synthesize(
    main_grover,
    OptimizationConstraints(optimization_parameter='cx', max_width=10),
)
result = execute(program, backend='ibm')
# result.result_value() → pandas DataFrame: bitstring | count | probability


# =============================================================================
# DUAL DSL: Python SDK ↔ Native Qmod Language (.qmod files)
# =============================================================================
# The same Grover algorithm in native Qmod (used in the Classiq IDE):
#
#   qperm sat_oracle(const x: qbit[]) {
#       control ((x[0] & ~x[1]) | (~x[0] & x[1] & x[2])) {
#           phase(pi, x[0]);
#       }
#   }
#
#   qfunc main(output x: qbit[3]) {
#       allocate(x);
#       hadamard_transform(x);
#       power (2) {
#           grover_operator(lambda(q) { sat_oracle(q); }, hadamard_transform, x);
#       }
#   }
#
# Python SDK and .qmod files are two surfaces over the same synthesis engine.
# qperm (quantum permutation) is Qmod's qualifier for classical logic on quantum states.


# =============================================================================
# WHAT MAKES CLASSIQ UNIQUE
# =============================================================================

"""
1. SYNTHESIS NOT COMPILATION
   Classical compilers translate code to instructions 1:1.
   Classiq SEARCHES for the optimal circuit under constraints—same @qfunc model
   can produce different circuits when optimizing for width vs. depth.

2. WITHIN/APPLY — AUTOMATIC UNCOMPUTATION
   Quantum correctness requires cleaning up ancilla qubits after use.
   The within/apply block instructs the synthesis engine to automatically
   generate the inverse circuit, preventing ancilla leakage without
   manual dagger construction.

3. HIGHER-ORDER QUANTUM FUNCTIONS (QCallable)
   Algorithms like Grover and QPE are parameterized by the oracle.
   Any @qfunc can be passed as a QCallable argument, making algorithms
   generic templates over arbitrary quantum subroutines.

4. HARDWARE-AGNOSTIC EXECUTION
   The functional model is hardware-independent. Synthesis adapts it to
   the basis gates and qubit connectivity of IBM, Amazon, Azure, or Nvidia.

5. DUAL-INTERFACE DSL
   Python SDK (@qfunc) for programmatic use; native Qmod (.qmod) for the IDE.
   Both surfaces target the same synthesis engine, describing the same model.

NOT Qiskit (manual gate assembly), NOT Cirq (circuit construction DSL),
NOT PennyLane (gradient descent / VQA focus)—
Classiq is a quantum MODELING language with an optimization-based synthesis engine.
"""


# =============================================================================
# MENTAL MODEL
# =============================================================================

"""
Classiq execution flow:

@qfunc model → synthesize() → QuantumProgram → execute(backend) → DataFrame
      ↓              ↓              ↓                 ↓
  Functional    Synthesis      Gate-level          Measurement
  description   engine         circuit             results
  (Qmod/Python) (optimizer)    (qubits + gates)    (pandas)

Key abstractions:
  @qfunc           → quantum operation  (composable building block)
  within/apply     → phase oracle idiom (automatic uncomputation)
  QCallable arg    → algorithm template (higher-order quantum function)
  synthesize()     → optimization step  (width ↔ depth tradeoff)
  execute(X)       → hardware dispatch  (IBM / Amazon / Azure / Nvidia)
  qperm qualifier  → classical logic on qubits (Qmod native DSL)

Every algorithm = main @qfunc composed from library @qfuncs + synthesis.
The synthesis engine, not the programmer, decides the physical qubit layout.
"""
