"""
 * REPO-DNA: VibeVoice
 * Source: https://github.com/microsoft/VibeVoice
 * Identity: Real-time expressive TTS through next-token diffusion with ultra-low-rate continuous acoustic tokens
 * 
 * This is not the repo. This is what makes the repo unique.
"""

# =============================================================================
# IDENTITY CORE: Next-Token Diffusion for Speech
# =============================================================================
# VibeVoice's unique approach: Merge LLM text understanding with diffusion-based
# acoustic generation. Unlike pure autoregressive or pure diffusion TTS,
# VibeVoice uses LLM for dialogue flow and a diffusion head for high-fidelity details.

import torch
import torch.nn as nn
import math
from typing import Optional, List, Tuple

# =============================================================================
# SIGNATURE PATTERN 1: Ultra-Low Frame Rate Continuous Tokenizer (7.5 Hz)
# =============================================================================
# The genius: Most TTS systems use discrete tokens at 50-75 Hz.
# VibeVoice uses continuous tokens at 7.5 Hz - 10x more efficient for long sequences.

class AcousticTokenizer(nn.Module):
    """
    Continuous acoustic tokenizer operating at 7.5 Hz (133ms per frame).
    Preserves audio fidelity while drastically reducing sequence length.
    """
    def __init__(self, vae_dim=64, sample_rate=16000):
        super().__init__()
        self.vae_dim = vae_dim
        self.frame_rate = 7.5  # Hz - The secret sauce
        self.hop_length = int(sample_rate / self.frame_rate)  # ~2133 samples per frame
        
        # Encoder: audio -> continuous latent
        self.encoder = nn.Sequential(
            nn.Conv1d(1, 32, kernel_size=7, stride=2, padding=3),
            ConvRMSNorm(32),
            nn.SiLU(),
            nn.Conv1d(32, 64, kernel_size=7, stride=2, padding=3),
            ConvRMSNorm(64),
            nn.SiLU(),
            nn.Conv1d(64, vae_dim, kernel_size=7, stride=2, padding=3),
        )
        
        # Decoder: continuous latent -> audio
        self.decoder = nn.Sequential(
            nn.ConvTranspose1d(vae_dim, 64, kernel_size=7, stride=2, padding=3, output_padding=1),
            ConvRMSNorm(64),
            nn.SiLU(),
            nn.ConvTranspose1d(64, 32, kernel_size=7, stride=2, padding=3, output_padding=1),
            ConvRMSNorm(32),
            nn.SiLU(),
            nn.ConvTranspose1d(32, 1, kernel_size=7, stride=2, padding=3, output_padding=1),
        )
    
    def encode(self, audio_waveform):
        """audio -> continuous acoustic tokens at 7.5 Hz"""
        # audio: (batch, 1, time_samples)
        tokens = self.encoder(audio_waveform)  # (batch, vae_dim, time_frames @ 7.5Hz)
        return tokens
    
    def decode(self, tokens):
        """continuous acoustic tokens -> audio"""
        # tokens: (batch, vae_dim, time_frames @ 7.5Hz)
        audio = self.decoder(tokens)  # (batch, 1, time_samples)
        return audio

class ConvRMSNorm(nn.Module):
    """RMS normalization for convolutional layers"""
    def __init__(self, dim, eps=1e-5):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))
        self.eps = eps
    
    def forward(self, x):
        # x: (batch, channels, time)
        x = x.transpose(1, 2)  # (batch, time, channels)
        output = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)
        output = output * self.weight
        return output.transpose(1, 2)

# =============================================================================
# ARCHITECTURAL DNA: LLM Backbone + Diffusion Head
# =============================================================================
# Two-phase architecture:
# 1. Lower LLM layers encode text understanding
# 2. Upper LLM layers generate speech via diffusion head

class VibeVoiceBackbone(nn.Module):
    """
    Split-purpose LLM: Lower layers for text, upper layers for TTS.
    Based on Qwen2.5 (0.5B for realtime, 1.5B for long-form).
    """
    def __init__(self, hidden_size=1024, num_layers=24, tts_layers=20):
        super().__init__()
        self.hidden_size = hidden_size
        # Lower layers: Pure text encoding (4 layers in 0.5B model)
        self.text_layers = nn.ModuleList([
            TransformerLayer(hidden_size) for _ in range(num_layers - tts_layers)
        ])
        # Upper layers: Text + Speech generation (20 layers in 0.5B model)
        self.tts_layers = nn.ModuleList([
            TransformerLayer(hidden_size) for _ in range(tts_layers)
        ])
        self.embed_tokens = nn.Embedding(151936, hidden_size)  # Qwen2 vocab
        self.norm = nn.RMSNorm(hidden_size)
    
    def forward(self, input_ids, acoustic_embeds=None, attention_mask=None, past_key_values=None):
        """
        input_ids: Text token IDs
        acoustic_embeds: Optional speech frame embeddings to interleave
        past_key_values: Optional cached key-values for efficient generation
        """
        # Embed text
        hidden = self.embed_tokens(input_ids)
        
        # Lower layers: Text-only encoding
        for layer in self.text_layers:
            hidden = layer(hidden, attention_mask)
        
        # Upper layers: Interleave text and speech
        if acoustic_embeds is not None:
            # Merge text and speech embeddings in a windowed fashion
            hidden = self._interleave_modalities(hidden, acoustic_embeds)
        
        for layer in self.tts_layers:
            hidden = layer(hidden, attention_mask)
        
        return self.norm(hidden)
    
    def _interleave_modalities(self, text_hidden, acoustic_embeds):
        """Windowed interleaving of text and speech"""
        # This is the key to streaming: process text and speech in windows
        return torch.cat([text_hidden, acoustic_embeds], dim=1)

class TransformerLayer(nn.Module):
    """Standard transformer layer"""
    def __init__(self, hidden_size):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(hidden_size, num_heads=16, batch_first=True)
        self.mlp = nn.Sequential(
            nn.Linear(hidden_size, hidden_size * 4),
            nn.SiLU(),
            nn.Linear(hidden_size * 4, hidden_size)
        )
        self.input_layernorm = nn.RMSNorm(hidden_size)
        self.post_attention_layernorm = nn.RMSNorm(hidden_size)
    
    def forward(self, hidden, attention_mask=None):
        # Self-attention
        residual = hidden
        hidden = self.input_layernorm(hidden)
        hidden, _ = self.self_attn(hidden, hidden, hidden, attn_mask=attention_mask)
        hidden = residual + hidden
        
        # MLP
        residual = hidden
        hidden = self.post_attention_layernorm(hidden)
        hidden = self.mlp(hidden)
        return residual + hidden

# =============================================================================
# SIGNATURE PATTERN 2: Diffusion Head with Timestep Conditioning
# =============================================================================
# The diffusion process: Start from noise, iteratively denoise to high-fidelity speech.
# Uses DPM-Solver for fast sampling (5-10 steps vs typical 1000).

class DiffusionHead(nn.Module):
    """
    Converts LLM hidden states into acoustic tokens via iterative denoising.
    This is what enables high-fidelity expressive speech.
    """
    def __init__(self, llm_hidden_size=1024, acoustic_dim=64, num_layers=12):
        super().__init__()
        self.acoustic_dim = acoustic_dim
        self.llm_hidden_size = llm_hidden_size
        
        # Timestep embedder: Convert diffusion step to conditioning vector
        self.timestep_embedder = TimestepEmbedder(llm_hidden_size)
        
        # Input projection from acoustic to hidden dimension
        self.input_proj = nn.Linear(acoustic_dim, llm_hidden_size)
        
        # Cross-attention layers: Condition on LLM hidden states
        self.diffusion_layers = nn.ModuleList([
            DiffusionBlock(llm_hidden_size, acoustic_dim) for _ in range(num_layers)
        ])
        
        # Output projection
        self.final_layer = nn.Linear(llm_hidden_size, acoustic_dim)
    
    def forward(self, noisy_acoustic, timestep, llm_hidden, attention_mask=None):
        """
        noisy_acoustic: Noisy acoustic latent at current timestep
        timestep: Diffusion timestep (0=noise, 1=clean)
        llm_hidden: Conditioning from LLM backbone
        """
        # Embed timestep
        t_emb = self.timestep_embedder(timestep)
        
        # Project acoustic to hidden dimension
        hidden = self.input_proj(noisy_acoustic)
        
        # Apply diffusion blocks with cross-attention to LLM hidden
        for block in self.diffusion_layers:
            hidden = block(hidden, t_emb, llm_hidden, attention_mask)
        
        # Project back to acoustic space
        predicted_noise = self.final_layer(hidden)
        return predicted_noise

class TimestepEmbedder(nn.Module):
    """Sinusoidal timestep embedding (like in diffusion models)"""
    def __init__(self, hidden_size, frequency_embedding_size=256):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(frequency_embedding_size, hidden_size, bias=False),
            nn.SiLU(),
            nn.Linear(hidden_size, hidden_size, bias=False),
        )
        self.frequency_embedding_size = frequency_embedding_size
    
    def forward(self, timestep):
        # Convert scalar timestep to sinusoidal embedding
        half = self.frequency_embedding_size // 2
        freqs = torch.exp(-math.log(10000) * torch.arange(0, half, dtype=torch.float32) / half).to(timestep.device)
        args = timestep[:, None].float() * freqs[None]
        embedding = torch.cat([torch.cos(args), torch.sin(args)], dim=-1)
        return self.mlp(embedding)

class DiffusionBlock(nn.Module):
    """Single diffusion block with timestep modulation and cross-attention"""
    def __init__(self, hidden_size, acoustic_dim):
        super().__init__()
        self.norm1 = nn.LayerNorm(hidden_size)
        self.self_attn = nn.MultiheadAttention(hidden_size, num_heads=16, batch_first=True)
        
        # Cross-attention to LLM conditioning
        self.norm2 = nn.LayerNorm(hidden_size)
        self.cross_attn = nn.MultiheadAttention(hidden_size, num_heads=16, batch_first=True)
        
        # Timestep-modulated MLP (AdaLN)
        self.norm3 = nn.LayerNorm(hidden_size)
        self.mlp = nn.Sequential(
            nn.Linear(hidden_size, hidden_size * 4),
            nn.SiLU(),
            nn.Linear(hidden_size * 4, hidden_size)
        )
        
        # Timestep conditioning
        self.adaLN_modulation = nn.Linear(hidden_size, hidden_size * 2)
    
    def forward(self, hidden, timestep_emb, context, attention_mask=None):
        # Adaptive Layer Norm modulation
        shift, scale = self.adaLN_modulation(timestep_emb).chunk(2, dim=-1)
        
        # Self-attention
        residual = hidden
        hidden = self.norm1(hidden) * (1 + scale.unsqueeze(1)) + shift.unsqueeze(1)
        hidden, _ = self.self_attn(hidden, hidden, hidden)
        hidden = residual + hidden
        
        # Cross-attention to LLM context
        residual = hidden
        hidden = self.norm2(hidden)
        hidden, _ = self.cross_attn(hidden, context, context, attn_mask=attention_mask)
        hidden = residual + hidden
        
        # MLP
        residual = hidden
        hidden = self.norm3(hidden)
        hidden = self.mlp(hidden)
        return residual + hidden

# =============================================================================
# SIGNATURE PATTERN 3: Windowed Streaming Generation
# =============================================================================
# The key to real-time: Process text in small windows (5 tokens text, 6 frames speech)
# while continuously generating speech from previous context.

TTS_TEXT_WINDOW = 5      # Process 5 text tokens at a time
TTS_SPEECH_WINDOW = 6    # Generate 6 acoustic frames (~800ms @ 7.5Hz)

class SimpleTextTokenizer:
    """Minimal tokenizer for demonstration purposes"""
    def encode(self, text):
        # Simple character-level tokenization for demo
        return [ord(c) for c in text[:100]]  # Truncate for demo

class StreamingGenerator:
    """
    Streaming text-to-speech with interleaved windowed generation.
    This enables ~300ms first-chunk latency.
    """
    def __init__(self, model, tokenizer, acoustic_tokenizer, voice_embedding):
        self.model = model
        self.tokenizer = tokenizer if tokenizer else SimpleTextTokenizer()
        self.acoustic_tokenizer = acoustic_tokenizer
        self.voice_embedding = voice_embedding  # Embedded speaker identity
        self.ddpm_steps = 10  # Fast sampling: 10 DPM-Solver steps
    
    def generate_streaming(self, text_stream):
        """
        text_stream: Iterator yielding text chunks as they arrive
        Yields: Audio chunks as they're generated
        """
        # Initialize state
        text_buffer = []
        past_key_values = None
        generated_acoustic_tokens = []
        
        for text_chunk in text_stream:
            # Tokenize incoming text
            text_tokens = self.tokenizer.encode(text_chunk)
            text_buffer.extend(text_tokens)
            
            # Process text in windows
            while len(text_buffer) >= TTS_TEXT_WINDOW:
                # Take window of text tokens
                window_tokens = text_buffer[:TTS_TEXT_WINDOW]
                text_buffer = text_buffer[TTS_TEXT_WINDOW:]
                
                # Encode text through LLM backbone
                input_ids = torch.tensor([window_tokens])
                llm_hidden = self.model.backbone(
                    input_ids,
                    acoustic_embeds=self.voice_embedding,
                    past_key_values=past_key_values
                )
                
                # Generate speech window via diffusion
                acoustic_window = self._diffusion_generate(
                    llm_hidden,
                    num_frames=TTS_SPEECH_WINDOW
                )
                generated_acoustic_tokens.append(acoustic_window)
                
                # Decode to audio and yield
                audio_chunk = self.acoustic_tokenizer.decode(acoustic_window)
                yield audio_chunk
    
    def _diffusion_generate(self, conditioning, num_frames):
        """
        Generate acoustic tokens via DPM-Solver diffusion.
        Fast sampling: 10 steps instead of 1000.
        """
        batch_size = conditioning.shape[0]
        
        # Start from noise
        acoustic_shape = (batch_size, self.acoustic_tokenizer.vae_dim, num_frames)
        acoustic_tokens = torch.randn(acoustic_shape, device=conditioning.device)
        
        # DPM-Solver timesteps (non-uniform for efficiency)
        timesteps = self._get_dpm_timesteps(self.ddpm_steps)
        
        # Iterative denoising
        for i, t in enumerate(timesteps):
            timestep_tensor = torch.full((batch_size,), t, device=conditioning.device)
            
            # Predict noise
            predicted_noise = self.model.diffusion_head(
                acoustic_tokens,
                timestep_tensor,
                conditioning
            )
            
            # DPM-Solver update (fast ODE solver)
            if i < len(timesteps) - 1:
                next_t = timesteps[i + 1]
                acoustic_tokens = self._dpm_solver_step(
                    acoustic_tokens, predicted_noise, t, next_t
                )
        
        return acoustic_tokens
    
    def _get_dpm_timesteps(self, num_steps):
        """Non-uniform timestep schedule for fast sampling"""
        # Cosine schedule concentrated near t=0 (clean)
        return torch.cos(torch.linspace(0, math.pi / 2, num_steps)) ** 2
    
    def _dpm_solver_step(self, x, noise_pred, t, next_t):
        """Single step of DPM-Solver ODE solver"""
        # Simplified: In practice uses higher-order solver
        alpha_t = torch.sqrt(1 - t)
        alpha_next = torch.sqrt(1 - next_t)
        
        # Predict x0
        x0_pred = (x - torch.sqrt(t) * noise_pred) / alpha_t
        
        # Take step toward x0
        x_next = alpha_next * x0_pred + torch.sqrt(next_t) * noise_pred
        return x_next

# =============================================================================
# ARCHITECTURAL DNA: EOS Prediction for Natural Turn-Taking
# =============================================================================
# Knows when to stop speaking - critical for natural conversation flow.

class BinaryEOSClassifier(nn.Module):
    """Predicts end-of-speech from LLM hidden states"""
    def __init__(self, hidden_size):
        super().__init__()
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Linear(hidden_size // 2, 1),
            nn.Sigmoid()
        )
    
    def forward(self, hidden_states):
        """Returns probability of end-of-speech"""
        return self.classifier(hidden_states[:, -1, :])  # Use last token

# =============================================================================
# THE "AHA" CODE: Complete Streaming Pipeline
# =============================================================================
# This is the essence - real-time TTS in action

class VibeVoiceRealtime:
    """
    Complete VibeVoice streaming TTS system.
    Demonstrates the entire philosophy: LLM understanding + diffusion quality + streaming.
    """
    def __init__(self, model_name="microsoft/VibeVoice-Realtime-0.5B"):
        # Load model components
        self.acoustic_tokenizer = AcousticTokenizer(vae_dim=64)
        self.backbone = VibeVoiceBackbone(hidden_size=1024, num_layers=24, tts_layers=20)
        self.diffusion_head = DiffusionHead(llm_hidden_size=1024, acoustic_dim=64)
        self.eos_classifier = BinaryEOSClassifier(hidden_size=1024)
        
        # Pre-embedded voice identities (for low latency)
        self.voice_embeddings = {
            "Carter": torch.randn(1, 1, 1024),  # Embedded speaker
            "Emma": torch.randn(1, 1, 1024),
            # More speakers...
        }
    
    def synthesize_streaming(self, text_iterator, speaker="Carter"):
        """
        Main API: Stream text in, stream audio out.
        First chunk arrives in ~300ms.
        """
        voice_emb = self.voice_embeddings[speaker]
        
        generator = StreamingGenerator(
            self, 
            tokenizer=None,  # Would use VibeVoiceTextTokenizer
            acoustic_tokenizer=self.acoustic_tokenizer,
            voice_embedding=voice_emb
        )
        
        # Yield audio chunks as they're generated
        for audio_chunk in generator.generate_streaming(text_iterator):
            # Each chunk is ~800ms of audio (6 frames @ 7.5Hz)
            yield audio_chunk
    
    def synthesize(self, text, speaker="Carter", max_duration_sec=600):
        """
        Batch mode: Generate complete audio for long-form content.
        Supports up to 10 minutes (90 minutes for multi-speaker variant).
        """
        # Convert text to token stream
        def text_stream():
            yield text
        
        # Collect all audio chunks
        audio_chunks = list(self.synthesize_streaming(text_stream(), speaker))
        
        # Concatenate
        full_audio = torch.cat(audio_chunks, dim=-1)
        return full_audio

# =============================================================================
# EXTENSION POINT: Voice Customization
# =============================================================================
# Pre-embedded voices for low latency, but architecture supports custom voices.

class VoiceEncoder(nn.Module):
    """
    Encode voice prompt into embedding space.
    Not used in realtime (uses pre-embedded) but shows extension path.
    """
    def __init__(self, acoustic_dim=64, embedding_dim=1024):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(acoustic_dim, 512),
            nn.SiLU(),
            nn.Linear(512, embedding_dim)
        )
    
    def forward(self, voice_prompt_acoustic):
        """voice_prompt: Few seconds of reference audio"""
        # Average pool across time
        pooled = voice_prompt_acoustic.mean(dim=-1)
        return self.encoder(pooled)

# =============================================================================
# WHAT MAKES VIBEVOICE UNIQUE
# =============================================================================

"""
1. NEXT-TOKEN DIFFUSION HYBRID
   - LLM provides context understanding and dialogue flow
   - Diffusion head provides high-fidelity acoustic details
   - Best of both worlds: coherent + expressive

2. ULTRA-LOW FRAME RATE (7.5 Hz)
   - 10x fewer tokens than typical TTS (vs 50-75 Hz)
   - Enables 90-minute generation with manageable sequence length
   - Continuous (not discrete) tokens preserve quality

3. WINDOWED STREAMING ARCHITECTURE
   - Text and speech processed in small interleaved windows
   - Enables real-time generation with ~300ms first-chunk latency
   - Supports streaming text input (speak as LLM generates)

4. SPLIT-PURPOSE LLM BACKBONE
   - Lower layers: Pure text understanding
   - Upper layers: Text + speech generation
   - Efficient: No separate text encoder needed

5. FAST DIFFUSION SAMPLING (DPM-Solver)
   - 10 steps instead of 1000 for diffusion models
   - Maintains quality while enabling real-time speed

6. NATURAL CONVERSATION DYNAMICS
   - EOS classifier for natural turn-taking
   - Multi-speaker support (long-form variant)
   - Preserves prosody, emotion, spontaneous singing
"""

# =============================================================================
# COMPARISON: What VibeVoice is NOT
# =============================================================================

# NOT pure autoregressive (like VALL-E):
#   - No discrete codec tokens
#   - Diffusion provides better quality for expressiveness

# NOT pure diffusion (like Grad-TTS):
#   - LLM provides dialogue understanding
#   - Can handle long-form conversations (not just sentences)

# NOT high frame rate (like most neural codecs):
#   - 7.5 Hz vs 50-75 Hz
#   - Enables long-form generation

# NOT slow/batch-only:
#   - Streaming architecture enables real-time
#   - ~300ms first chunk, continuous generation

# =============================================================================
# MENTAL MODEL
# =============================================================================

"""
Think of VibeVoice as:

Text Stream → [LLM Backbone] → Context Understanding
                    ↓
        [Voice Embedding] → Speaker Identity
                    ↓
    [Diffusion Head @ 7.5Hz] → Acoustic Tokens (continuous)
                    ↓
    [Acoustic Decoder] → High-Fidelity Audio

The magic is in the low frame rate (7.5Hz) enabling long sequences,
and the windowed streaming enabling real-time generation.
"""

# =============================================================================
# THE GENIUS MOVE
# =============================================================================

"""
Most TTS systems either:
1. Use autoregressive models with discrete tokens (coherent but slow)
2. Use diffusion models on high-rate features (quality but batch-only)

VibeVoice combines:
- LLM understanding (autoregressive nature for coherence)
- Diffusion quality (parallel generation of acoustic details)
- Ultra-low frame rate (7.5Hz continuous tokens)
- Streaming architecture (windowed interleaving)

This enables something unique: Real-time, long-form, expressive TTS
with natural dialogue flow. You can stream in text from an LLM and
stream out speech with <300ms latency, maintaining quality for hours.
"""

# =============================================================================
# IF YOU UNDERSTAND THIS, YOU UNDERSTAND VIBEVOICE
# =============================================================================

def vibevoice_essence():
    """The entire system in one example"""
    
    # 1. Acoustic tokenizer: Audio ↔ 7.5Hz continuous tokens
    tokenizer = AcousticTokenizer(vae_dim=64)
    audio_tokens = tokenizer.encode(audio_waveform)  # 16kHz audio → 7.5Hz tokens
    
    # 2. LLM backbone: Text + voice → contextual understanding
    llm_hidden = VibeVoiceBackbone()(
        text_token_ids,
        acoustic_embeds=voice_embedding
    )
    
    # 3. Diffusion head: Context → acoustic tokens via denoising
    acoustic_output = DiffusionHead()(
        noisy_tokens,
        timestep,
        conditioning=llm_hidden
    )
    
    # 4. Decode: Acoustic tokens → audio
    speech = tokenizer.decode(acoustic_output)
    
    # 5. Stream: Process text windows → generate speech windows
    for text_window in streaming_text:
        speech_window = generate(text_window)
        yield speech_window  # Audio every ~800ms

"""
The entire library in one sentence:
"LLM-guided iterative denoising of continuous acoustic tokens at 7.5 Hz,
 enabling real-time, long-form, expressive speech generation."
"""

# =============================================================================
# REAL WORLD USAGE
# =============================================================================

# Example 1: Real-time streaming from LLM
def stream_llm_to_speech(llm_token_stream):
    """Connect LLM output directly to TTS"""
    tts = VibeVoiceRealtime()
    for audio_chunk in tts.synthesize_streaming(llm_token_stream, speaker="Carter"):
        play_audio(audio_chunk)  # Start speaking within 300ms

# Example 2: Long-form content (podcast)
def generate_podcast(script, speakers):
    """Multi-speaker long-form generation (up to 90 minutes)"""
    tts = VibeVoiceRealtime()
    segments = split_by_speaker(script)
    audio_parts = []
    for segment in segments:
        audio = tts.synthesize(segment.text, speaker=segment.speaker)
        audio_parts.append(audio)
    return concatenate(audio_parts)

# Example 3: Interactive conversation
def interactive_assistant():
    """Real-time conversational AI"""
    tts = VibeVoiceRealtime()
    llm = LanguageModel()
    
    while True:
        user_input = listen_to_user()
        response_stream = llm.generate_streaming(user_input)
        
        # Speak while thinking
        for audio_chunk in tts.synthesize_streaming(response_stream):
            play_audio(audio_chunk)
