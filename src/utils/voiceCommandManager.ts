import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { speakText as ttsSpeakText, stopSpeaking as ttsStopSpeaking } from '../services/ttsService';
import { Platform } from 'react-native';

// Conditional import for expo-speech-recognition (not available in Expo Go)
let ExpoSpeechRecognitionModule: any = null;
try {
  ExpoSpeechRecognitionModule = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch (e) {}

// UPDATED: Voice command interface now supports full transcript
export interface VoiceCommand {
  keywords: string[];
  action: (fullTranscript?: string) => void; // CHANGED: Now receives full transcript
  description: string;
  category: 'navigation' | 'accessibility' | 'reminder' | 'general';
  captureFullTranscript?: boolean; // NEW: If true, passes full transcript to action
}

export class VoiceCommandManager {
  private commands: VoiceCommand[] = [];
  private isListening = false;
  private currentScreen = 'login';
  private cooldownUntil = 0; // epoch ms to ignore triggers
  private cooldownMs = 1200; // prevents TTS response from being re-interpreted as a command
  private recognition: any = null;
  private recognizing = false;
  private listenersInitialized = false;
  private voiceAnnouncementsEnabled = true; // Global toggle for voice announcements
  private onStopCallback: (() => void) | null = null;
  private onTranscriptCallback: ((text: string, isFinal: boolean) => void) | null = null;

  setCurrentScreen(screen: string) {
    this.currentScreen = screen;
    this.cooldownUntil = Date.now() + this.cooldownMs;
  }

  setVoiceAnnouncementsEnabled(enabled: boolean) {
    this.voiceAnnouncementsEnabled = enabled;
  }

  addCommand(command: VoiceCommand) {
    this.commands.push(command);
  }

  removeCommand(keywords: string[]) {
    this.commands = this.commands.filter(cmd => 
      !cmd.keywords.some(keyword => keywords.includes(keyword))
    );
  }

  // UPDATED: Now passes full transcript to commands that need it
  processVoiceInput(input: string): boolean {
    const now = Date.now();
    if (now < this.cooldownUntil) {
      return false; // ignore triggers during cooldown to prevent instant jumps
    }
    const normalizedInput = input.toLowerCase().trim();

    for (const cmd of this.commands) {
      const hasKeyword = cmd.keywords.some(keyword =>
        normalizedInput.includes(keyword.toLowerCase())
      );

      if (hasKeyword) {
        if (cmd.captureFullTranscript) {
          cmd.action(input);
        } else {
          cmd.action();
        }

        this.cooldownUntil = Date.now() + this.cooldownMs;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return true;
      }
    }

    return false;
  }

  speak(text: string, rate: number = 1.0) {
    if (!this.voiceAnnouncementsEnabled) return;
    const safeRate = Math.max(0.5, Math.min(rate, 2.0));
    ttsSpeakText(text, {
      rate: safeRate,
      pitch: 1.0,
    });
    this.cooldownUntil = Date.now() + this.cooldownMs;
  }

  async startListening(onStop?: () => void, onTranscript?: (text: string, isFinal: boolean) => void) {
    if (this.recognizing) {
      return;
    }

    // Store callbacks so listeners can report live transcripts and stop events
    this.onStopCallback = onStop ?? null;
    this.onTranscriptCallback = onTranscript ?? null;

    // Web (Expo web / Chrome) uses the browser's built-in SpeechRecognition API
    if (Platform.OS === 'web') {
      this.isListening = true;
      this.startWebSpeechRecognition();
      return;
    }

    // Native: requires expo-speech-recognition (dev build only, not in Expo Go)
    if (!ExpoSpeechRecognitionModule) {
      this.speak('Voice recognition is not available. Please use a development build to enable this feature.');
      this.onStopCallback?.();
      return;
    }

    this.isListening = true;

    try {
      // Request permissions using the module's method
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!result.granted) {
        this.speak('Microphone permission is required for voice commands');
        return;
      }

      // Set up listeners only once
      if (!this.listenersInitialized) {

        ExpoSpeechRecognitionModule.addListener('start', () => {
          this.recognizing = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        });

        ExpoSpeechRecognitionModule.addListener('end', () => {
          this.recognizing = false;
          this.isListening = false;
          this.onStopCallback?.();
        });

        ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
          const transcript = event.results?.[0]?.transcript;
          const isFinal = event.isFinal;
          
          if (transcript) {
            this.onTranscriptCallback?.(transcript, !!isFinal);
            if (isFinal && this.isListening) {
              this.processVoiceInput(transcript);
            }
          }
        });

        ExpoSpeechRecognitionModule.addListener('error', () => {
          this.recognizing = false;
          this.isListening = false;
          this.onStopCallback?.();
        });

        this.listenersInitialized = true;
      }

      // Start recognition
      const options = {
        lang: 'en-US',
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
        contextualStrings: [],
      };
      
      try {
        ExpoSpeechRecognitionModule.start(options);
      } catch (startError) {
        throw startError;
      }
      
    } catch (error) {
      this.speak('Unable to start voice recognition');
      this.recognizing = false;
      this.isListening = false;
    }
  }

  private startWebSpeechRecognition() {
    try {
      const globalObj: any = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : {};
      const SRWeb: any = 
        globalObj.webkitSpeechRecognition || 
        globalObj.SpeechRecognition;
        
      if (SRWeb) {
        const rec = new SRWeb();
        rec.lang = 'en-US';
        rec.continuous = true;
        rec.interimResults = false;
        
        rec.onresult = (event: any) => {
          const last = event.results?.[event.results.length - 1];
          const text = last?.[0]?.transcript;
          if (text && this.isListening) {
            this.processVoiceInput(String(text));
          }
        };
        
        rec.onerror = (err: any) => {
          console.warn('VoiceCommandManager: Web speech recognition error:', err);
          this.recognizing = false;
          this.isListening = false;
          this.onStopCallback?.();
        };
        
        rec.onend = () => {
          this.recognizing = false;
          this.isListening = false;
          this.onStopCallback?.();
        };
        
        rec.start();
        this.recognition = rec;
        this.recognizing = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else {
        this.speak('Microphone not available on this device');
      }
    } catch (error) {
      this.speak('Unable to start listening');
    }
  }

  stopListening() {
    this.isListening = false;
    
    try {
      if (this.recognizing) {
        
        if (Platform.OS !== 'web') {
          ExpoSpeechRecognitionModule?.stop();
        } else if (this.recognition) {
          this.recognition.stop();
        }
      }
    } catch (error) {
      console.log('VoiceCommandManager: Error stopping recognition:', error);
    }
    
    this.recognizing = false;
    this.recognition = null;
    this.speak('Stopped listening');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  isActive(): boolean {
    return this.isListening;
  }

  getAvailableCommands(): VoiceCommand[] {
    return this.commands;
  }

  getCommandsForScreen(screen: string): VoiceCommand[] {
    return this.commands.filter(cmd =>
      cmd.category === 'general' ||
      (screen === 'login' && cmd.category === 'navigation') ||
      (screen === 'setup' && cmd.category === 'accessibility') ||
      (screen === 'home' && ['navigation', 'accessibility', 'reminder'].includes(cmd.category)) ||
      (screen === 'reminders' && ['navigation', 'reminder'].includes(cmd.category)) ||
      (screen === 'profile' && ['navigation', 'accessibility'].includes(cmd.category)) ||
      (screen === 'checkin' && cmd.category === 'navigation') ||
      (screen === 'assistant' && cmd.category === 'navigation') ||
      (screen === 'community' && cmd.category === 'navigation')
    );
  }

  announceScreenChange(screen: string) {
    const screenNames: { [key: string]: string } = {
      'login':     'Login screen',
      'setup':     'Accessibility setup',
      'home':      'Home screen',
      'reminders': 'Reminders screen',
      'profile':   'Profile screen',
      'checkin':   'Daily check-in screen',
      'assistant': 'AI Assistant screen',
      'community': 'Community screen',
    };

    this.speak(`Now on ${screenNames[screen] || screen}`);
    this.setCurrentScreen(screen);
  }
}

// Create singleton instance
let voiceManagerInstance: VoiceCommandManager | null = null;

// Factory function to get the voice manager instance
export function getVoiceManager(): VoiceCommandManager {
  if (!voiceManagerInstance) {
    voiceManagerInstance = new VoiceCommandManager();
  }
  return voiceManagerInstance;
}

// Global voice command manager - use factory for safer initialization
export const voiceManager = getVoiceManager();