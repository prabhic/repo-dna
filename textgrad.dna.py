"""
REPO-DNA: TextGrad
Source: https://github.com/zou-group/textgrad
Identity: Automatic differentiation via text—backpropagation through language model feedback

This is not the repo. This is what makes the repo unique.
"""

# =============================================================================
# IDENTITY CORE: Autodiff for Text
# =============================================================================
# TextGrad's unique insight: Treat LLM optimization as a computational graph
# where gradients flow backward through *language*, not numbers. Instead of
# updating model weights, it refines prompts and outputs using textual feedback.

class Variable:
    """
    The fundamental unit - text with gradient tracking.
    Like PyTorch's Tensor, but for language.
    """
    def __init__(self, value, role_description="", requires_grad=True):
        self.value = value  # The actual text content
        self.role_description = role_description  # What this text represents
        self.requires_grad = requires_grad  # Should we optimize this?
        self.gradients = set()  # Textual feedback (not numerical!)
        self.predecessors = []  # Computation graph edges
        self.backward_fn = None  # How to propagate gradients
        
    def backward(self, gradient=None):
        """
        Backpropagate textual feedback through the computation graph.
        Unlike numerical gradients, these are natural language instructions.
        """
        if not self.requires_grad:
            return
            
        if gradient is not None:
            self.gradients.add(gradient)
        
        # Propagate to predecessors (like autograd in PyTorch)
        if self.backward_fn:
            self.backward_fn()
    
    def reset_gradients(self):
        """Clear accumulated textual feedback"""
        self.gradients = set()
    
    def get_gradient_text(self):
        """Combine all textual gradients into improvement instructions"""
        if not self.gradients:
            return ""
        return "\n".join(f"- {g}" for g in self.gradients)
    
    def __repr__(self):
        grad_status = "grad" if self.requires_grad else "no_grad"
        return f"Variable(role='{self.role_description}', {grad_status})"


# =============================================================================
# SIGNATURE PATTERN 1: LLM as a Differentiable Function
# =============================================================================
# Key pattern: Wrap LLM calls to automatically build computation graphs

class BlackboxLLM:
    """
    Treats any LLM as a differentiable function.
    Forward: Generate text
    Backward: Determine how inputs should change based on output critique
    """
    def __init__(self, model_name="gpt-4o", system_prompt=None):
        self.model_name = model_name
        self.system_prompt = system_prompt or "You are a helpful assistant."
    
    def __call__(self, input_variable):
        """
        Forward pass: Generate text and track the operation.
        Returns a new Variable connected to the input.
        """
        if not isinstance(input_variable, Variable):
            input_variable = Variable(input_variable, requires_grad=False)
        
        # Simulate LLM call (in real implementation, this calls OpenAI/Anthropic)
        output_text = self._generate(input_variable.value)
        
        # Create output Variable with computation graph connection
        output = Variable(
            output_text,
            role_description=f"response from {self.model_name}",
            requires_grad=True
        )
        output.predecessors = [input_variable]
        
        # Define backward pass: how to refine input based on output feedback
        def backward_fn():
            if output.gradients and input_variable.requires_grad:
                # Create gradient for input: "improve your question to get better answer"
                feedback = output.get_gradient_text()
                input_gradient = self._create_input_gradient(
                    input_variable.value,
                    output.value,
                    feedback
                )
                input_variable.backward(input_gradient)
        
        output.backward_fn = backward_fn
        return output
    
    def _generate(self, prompt):
        """Simulated LLM generation (real impl would call API)"""
        return f"Generated response to: {prompt[:50]}..."
    
    def _create_input_gradient(self, input_text, output_text, output_feedback):
        """
        Create textual gradient for input based on output critique.
        This is the 'chain rule' for text!
        """
        return (
            f"To improve the output which received feedback: '{output_feedback}', "
            f"consider refining the input: '{input_text[:50]}...'"
        )


# =============================================================================
# SIGNATURE PATTERN 2: Natural Language Loss Functions
# =============================================================================
# Instead of MSE or CrossEntropy, loss is specified in plain English

class TextLoss:
    """
    A loss function defined in natural language.
    Evaluates outputs and returns textual feedback as 'gradients'.
    """
    def __init__(self, evaluation_instruction, engine="gpt-4o"):
        self.instruction = evaluation_instruction
        self.engine = engine
    
    def __call__(self, output_variable):
        """
        Evaluate the output and return a loss Variable containing feedback.
        The 'loss' is not a number—it's critical analysis in text form.
        """
        # Simulate LLM-based evaluation
        feedback = self._evaluate(output_variable.value)
        
        loss = Variable(
            feedback,
            role_description="loss feedback",
            requires_grad=False  # Loss itself doesn't need optimization
        )
        loss.predecessors = [output_variable]
        
        # Backward pass: propagate feedback to the output
        def backward_fn():
            output_variable.backward(feedback)
        
        loss.backward_fn = backward_fn
        return loss
    
    def _evaluate(self, output):
        """
        Simulate LLM evaluation. In reality, sends:
        'Given this instruction: {self.instruction}
         Evaluate this output: {output}
         Provide critical feedback.'
        """
        return f"Feedback based on '{self.instruction[:40]}...': Consider improving clarity"


# =============================================================================
# ARCHITECTURAL DNA: Textual Gradient Descent (TGD)
# =============================================================================
# Instead of SGD updating weights with -lr * gradient, TGD refines text with LLM

class TGD:
    """
    Textual Gradient Descent - the optimizer for text variables.
    Uses accumulated textual feedback to refine variables.
    """
    def __init__(self, parameters):
        """
        Parameters: list of Variables to optimize (like nn.parameters() in PyTorch)
        """
        self.parameters = [p for p in parameters if p.requires_grad]
    
    def step(self, engine="gpt-4o"):
        """
        Apply 'gradients' to refine each parameter.
        This is where the magic happens: LLM synthesizes improvements from feedback.
        """
        for param in self.parameters:
            if not param.gradients:
                continue
            
            # Combine all feedback into optimization prompt
            gradient_text = param.get_gradient_text()
            
            # Use LLM to synthesize improved version
            improved_value = self._apply_gradient(
                param.value,
                gradient_text,
                param.role_description
            )
            
            param.value = improved_value
    
    def _apply_gradient(self, current_value, feedback, role):
        """
        Use LLM to refine text based on accumulated feedback.
        This is analogous to: new_param = old_param - lr * gradient
        """
        prompt = f"""
        Current {role}: {current_value}
        
        Feedback received:
        {feedback}
        
        Provide an improved version that addresses the feedback.
        Only output the improved text, nothing else.
        """
        # Simulate LLM call for refinement
        return f"Improved version of: {current_value[:50]}..."
    
    def zero_grad(self):
        """Clear gradients, just like PyTorch"""
        for param in self.parameters:
            param.reset_gradients()


# =============================================================================
# EXTENSION POINT: Custom Loss Functions
# =============================================================================
# Users can define domain-specific losses in natural language

class CodeQualityLoss(TextLoss):
    """Example: Evaluate code using natural language criteria"""
    def __init__(self):
        super().__init__(
            "Evaluate this code for correctness, efficiency, and readability. "
            "Provide specific, actionable feedback."
        )

class MoleculeViabilityLoss(TextLoss):
    """Example: Evaluate molecule descriptions for drug-likeness"""
    def __init__(self):
        super().__init__(
            "Evaluate this molecule for drug-likeness, considering Lipinski's rules, "
            "toxicity potential, and synthetic accessibility."
        )


# =============================================================================
# THE "AHA" CODE: End-to-End Optimization
# =============================================================================
# This demonstrates the full power: optimize an entire LLM pipeline

def optimize_reasoning():
    """
    Complete example: Optimize an LLM's answer using textual backprop.
    This is what makes TextGrad unique—interpretable, end-to-end optimization.
    """
    # Setup
    model = BlackboxLLM("gpt-4o")
    
    # The question (fixed input)
    question = Variable(
        "If it takes 1 hour to dry 25 shirts, how long for 30 shirts?",
        role_description="question to the LLM",
        requires_grad=False
    )
    
    # Initial answer (to be optimized)
    answer = model(question)
    answer.role_description = "answer to the question"
    
    # Define what makes a good answer
    loss_fn = TextLoss(
        "Evaluate logical correctness and reasoning quality. "
        "Be critical of faulty assumptions."
    )
    
    # Optimizer for the answer
    optimizer = TGD(parameters=[answer])
    
    # Optimization loop (like training in PyTorch)
    for iteration in range(3):
        optimizer.zero_grad()
        
        # Forward pass
        loss = loss_fn(answer)
        
        # Backward pass (accumulate textual feedback)
        loss.backward()
        
        # Update step (refine text based on feedback)
        optimizer.step()
        
        print(f"Iteration {iteration + 1}")
        print(f"Answer: {answer.value}")
        print(f"Feedback: {loss.value}\n")
    
    return answer


# =============================================================================
# USAGE EXAMPLE: Multi-variable Optimization
# =============================================================================
# TextGrad can optimize multiple variables simultaneously

def optimize_prompt_and_answer():
    """
    Advanced: Optimize both the system prompt AND the answer together.
    Shows the true power of backprop through text.
    """
    # Both the prompt and answer are optimizable
    system_prompt = Variable(
        "You are a helpful assistant.",
        role_description="system prompt",
        requires_grad=True
    )
    
    question = Variable(
        "Explain quantum computing to a 5-year-old.",
        requires_grad=False
    )
    
    model = BlackboxLLM("gpt-4o")
    model.system_prompt = system_prompt.value
    
    answer = model(question)
    
    # Loss that evaluates answer quality
    loss_fn = TextLoss(
        "Evaluate if explanation is age-appropriate, accurate, and engaging."
    )
    
    # Optimize BOTH prompt and answer
    optimizer = TGD(parameters=[system_prompt, answer])
    
    for _ in range(2):
        optimizer.zero_grad()
        loss = loss_fn(answer)
        loss.backward()
        optimizer.step()
    
    return system_prompt, answer


# =============================================================================
# COMPARISON: Why TextGrad is Different
# =============================================================================

"""
Traditional ML:          TextGrad:
--------------          ----------
Parameters: Weights      Parameters: Text (prompts, outputs)
Gradients: Numbers       Gradients: Natural language feedback
Loss: Numerical error    Loss: LLM critique
Optimizer: SGD/Adam      Optimizer: TGD (text refinement via LLM)
Update: w -= lr * ∇w     Update: text = LLM(text + feedback)

Key Innovation: Makes LLM pipelines end-to-end optimizable without
fine-tuning. The entire optimization process is interpretable because
gradients are human-readable text.
"""


# =============================================================================
# REAL-WORLD EXTENSIONS
# =============================================================================

class MultiFieldVariable(Variable):
    """
    Extension: Variables with structured content (e.g., JSON, code with tests)
    Each field can receive targeted feedback.
    """
    def __init__(self, fields, role_description=""):
        value = self._serialize(fields)
        super().__init__(value, role_description)
        self.fields = fields
    
    def _serialize(self, fields):
        return "\n".join(f"{k}: {v}" for k, v in fields.items())


class ConstrainedOptimizer(TGD):
    """
    Extension: TGD with constraints (e.g., "keep under 100 words")
    Adds constraint satisfaction to the refinement process.
    """
    def __init__(self, parameters, constraints):
        super().__init__(parameters)
        self.constraints = constraints
    
    def _apply_gradient(self, current_value, feedback, role):
        constraint_text = "\n".join(f"- {c}" for c in self.constraints)
        prompt = f"""
        Current {role}: {current_value}
        
        Feedback: {feedback}
        
        Constraints to maintain:
        {constraint_text}
        
        Provide improved version that addresses feedback while respecting constraints.
        """
        return f"Constrained improvement: {current_value[:50]}..."


# =============================================================================
# SUMMARY: The TextGrad Paradigm
# =============================================================================

"""
TextGrad inverts traditional ML optimization:

1. No Parameter Training: Optimize what LLMs generate, not LLM weights
2. Interpretable Gradients: Feedback is readable text, not opaque vectors  
3. Composable: Chain multiple LLM calls and optimize end-to-end
4. Black-box: Works with any LLM via API (OpenAI, Anthropic, etc.)

The core abstraction is deceptively simple: wrap text in Variables, build
computation graphs implicitly through operations, backpropagate textual
feedback, and use an LLM to synthesize improvements. This enables systematic
optimization of LLM behavior without manual prompt engineering or fine-tuning.

Use cases:
- Optimize prompts for better outputs
- Refine code based on test failures (textual feedback)
- Improve molecule descriptions based on property predictions
- Optimize multi-step reasoning chains
- Co-optimize system prompts and outputs together
"""
