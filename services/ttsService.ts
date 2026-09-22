import { speakText, stopSpeaking } from "../src/services/ttsService";
import AsyncStorage from "@react-native-async-storage/async-storage";

let cachedTalkEnabled: boolean | null = null;

export const speakIfEnabled = async (text: string) => {
  try {
    if (cachedTalkEnabled === null) {
      const val = await AsyncStorage.getItem("talkEnabled");
      cachedTalkEnabled = val === null ? true : val === "true";
    }

    if (!cachedTalkEnabled) return;
    await speakText(text);
  } catch (error) {
    console.error("🔇 TTS Error:", error);
  }
};

export const setTalkingPreference = async (enabled: boolean) => {
  try {
    cachedTalkEnabled = enabled;
    await AsyncStorage.setItem("talkEnabled", enabled ? "true" : "false");
  } catch (error) {
    console.error("Error saving talking preference:", error);
  }
};

export const getTalkingPreference = async (): Promise<boolean> => {
  try {
    if (cachedTalkEnabled !== null) return cachedTalkEnabled;
    const value = await AsyncStorage.getItem("talkEnabled");
    cachedTalkEnabled = value === null ? true : value === "true";
    return cachedTalkEnabled;
  } catch (error) {
    console.error("Error reading talking preference:", error);
    return true;
  }
};

export const stopSpeech = async () => {
  await stopSpeaking();
};

export { speakText, stopSpeaking };
