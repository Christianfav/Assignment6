import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  Button,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Audio } from "expo-av";
import { Buffer } from "buffer";
import OpenAI from "openai";
import { OPENAI_API_KEY } from "@env";
import { SafeAreaView } from "react-native-safe-area-context";

// ✅ Initialize OpenAI client
const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// ✅ Voice Theme Selector
const VoiceThemeSelector = ({ selectedVoice, onVoiceSelected }) => {
  const voiceThemes = {
    alloy: {
      color: "#6200ee",
      icon: "record-voice-over",
      description: "Neutral, balanced voice with clear articulation",
    },
    echo: {
      color: "#3700b3",
      icon: "surround-sound",
      description: "Deep, resonant voice with a measured pace",
    },
    fable: {
      color: "#03dac4",
      icon: "auto-stories",
      description: "Warm, friendly voice with expressive tones",
    },
    onyx: {
      color: "#333333",
      icon: "mic",
      description: "Rich, authoritative voice with depth",
    },
    nova: {
      color: "#bb86fc",
      icon: "stars",
      description: "Bright, energetic voice with upbeat delivery",
    },
    shimmer: {
      color: "#018786",
      icon: "waves",
      description: "Soft, gentle voice with a soothing quality",
    },
  };

  return (
    <SafeAreaView style={styles.voiceThemeContainer}>
      <Text style={styles.voiceThemeTitle}>Select Voice Theme</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.voiceThemeScroll}
      >
        {Object.entries(voiceThemes).map(([voice, theme]) => (
          <TouchableOpacity
            key={voice}
            style={[
              styles.voiceThemeOption,
              { backgroundColor: theme.color },
              selectedVoice === voice && styles.selectedVoiceTheme,
            ]}
            onPress={() => onVoiceSelected(voice)}
          >
            <MaterialIcons name={theme.icon} size={24} color="white" />
            <Text style={styles.voiceThemeName}>
              {voice.charAt(0).toUpperCase() + voice.slice(1)}
            </Text>
            <Text style={styles.voiceThemeDescription}>
              {theme.description}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};


// 🔥 NEW SYSTEM PROMPT (STRICT JSON)
const systemPrompt = `

You are a legal document comprehension assistant — NOT a lawyer. You do not provide legal advice. 
You summarize and explain. Analyze the photographed document and return JSON: 
{ "document_type": "contract | court_order | regulation | certificate | other",
"parties": ["list of named parties"], "key_dates": [{"label": "", "date": ""}], 
"obligations": ["list obligations of each party"], "risk_flags": [{"clause": "", "risk": "low|medium|high", "explanation": ""}], 
"plain_summary": "3-sentence plain English summary", "spoken_summary": "2-sentence version optimized for text-to-speech", 
"required_actions": ["immediate actions the reader must take"], "disclaimer": "This is a summary for comprehension only. 
Consult a qualified attorney." } Flag: unusual indemnification, auto-renewal traps, one-sided arbitration, punitive clauses.

Flag if present:
- unusual indemnification
- auto-renewal traps
- one-sided arbitration
- punitive clauses

Rules:
- Return ONLY JSON
- No markdown
- No explanations outside JSON
`;


// ✅ Main App
export default function App() {
  const [imageLocation, setImageLocation] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sound, setSound] = useState(null);
  const [selectedVoice, setSelectedVoice] = useState("alloy");

  // ✅ Ensure audio works even in silent mode (important for iOS)
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
    });
  }, []);

  // 📸 Pick Image
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      setImageLocation(result.assets[0].uri);
      setAnalysis(null);
// and later
    }
  };

  // 📷 Take Photo (with safe permission + null checks)
  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Denied", "Camera access is required to take photos.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (!result || result.canceled || !result.assets || result.assets.length === 0) {
        Alert.alert("No photo captured", "Please try taking a picture again.");
        return;
      }

      const photoUri = result.assets[0].uri;
      console.log("Captured photo URI:", photoUri);
      setImageLocation(result.assets[0].uri);
setAnalysis(null);
// and later
    } catch (error) {
      console.error("Camera error:", error);
      Alert.alert("Camera Error", error.message || "Failed to access camera");
    }
  };

  // 🔊 Generate Audio (fixed)
  const generateAudio = async (text) => {
    try {
      if (!text) return;

      console.log("Generating TTS audio...");

      const response = await client.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: selectedVoice,
        input: text,
      });

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Audio = buffer.toString("base64");

      const audioPath = `${FileSystem.documentDirectory}speech.mp3`;

      await FileSystem.writeAsStringAsync(audioPath, base64Audio, {
        encoding: FileSystem.EncodingType.Base64,
      });

      console.log("TTS audio saved at:", audioPath);

      const { sound: playbackObj } = await Audio.Sound.createAsync(
        { uri: audioPath },
        { shouldPlay: true }
      );

      setSound(playbackObj);
    } catch (error) {
      console.error("🔊 Audio generation error:", error);
      Alert.alert("Audio Error", error.message || "Failed to generate speech");
    }
  };

  // 🖼️ Analyze Image + auto-read result
  const analyzeImage = async () => {
  if (!imageLocation) {
    Alert.alert("No Image", "Pick or take a photo first.");
    return;
  }

  try {
    setLoading(true);
    setAnalysis(null);

    const base64Image = await FileSystem.readAsStringAsync(imageLocation, {
      encoding: "base64",
    });

    console.log("Image loaded");

    const result = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this legal document." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    });

    let raw = result?.choices?.[0]?.message?.content;

    console.log("RAW RESPONSE:", raw);

    if (!raw) throw new Error("Empty AI response");

    // Clean JSON
    raw = raw.replace(/```json|```/g, "").trim();

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("JSON PARSE FAILED:", raw);
      Alert.alert("Parsing Error", "AI did not return valid JSON.");
      return;
    }

    console.log("PARSED:", parsed);


    if (parsed.spoken_summary) {
      await generateAudio(parsed.spoken_summary);
    }

  } catch (error) {
    console.error("FULL ERROR:", error);
    Alert.alert("Error", error.message || "Something broke.");
  } finally {
    setLoading(false);
  }
};

  return (
    <SafeAreaView>
   <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>BeMyEyesAndEars 👁️ 🎧</Text>

      <VoiceThemeSelector
        selectedVoice={selectedVoice}
        onVoiceSelected={setSelectedVoice}
      />

      <View style={styles.buttonRow}>
        <Button title="Pick an Image" onPress={pickImage} />
        <Button title="Take a Photo" onPress={takePhoto} />
      </View>

      {imageLocation && (
        <Image source={{ uri: imageLocation }} style={styles.image} />
      )}

      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
      ) : (
        <Button title="Describe & Read Aloud" onPress={analyzeImage} />
      )}

      {analysis && (
  <View style={styles.responseBox}>

    <Text style={styles.sectionTitle}>📄 Document Type</Text>
    <Text>{analysis.document_type}</Text>

    <Text style={styles.sectionTitle}>👥 Parties</Text>
    {analysis.parties.map((p, i) => (
      <Text key={i}>• {p}</Text>
    ))}

    <Text style={styles.sectionTitle}>📅 Key Dates</Text>
    {analysis.key_dates.map((d, i) => (
      <Text key={i}>• {d.label}: {d.date}</Text>
    ))}

    <Text style={styles.sectionTitle}>⚖️ Obligations</Text>
    {analysis.obligations.map((o, i) => (
      <Text key={i}>• {o}</Text>
    ))}

    <Text style={styles.sectionTitle}>🚨 Risk Flags</Text>
    {analysis.risk_flags.map((r, i) => (
      <Text key={i} style={{
        color: r.risk === "high" ? "red" :
               r.risk === "medium" ? "orange" : "green"
      }}>
        • [{r.risk.toUpperCase()}] {r.explanation}
      </Text>
    ))}

    <Text style={styles.sectionTitle}>🧾 Summary</Text>
    <Text>{analysis.plain_summary}</Text>

    <Text style={styles.sectionTitle}>✅ Required Actions</Text>
    {analysis.required_actions.map((a, i) => (
      <Text key={i}>• {a}</Text>
    ))}

    <Text style={styles.disclaimer}>
      {analysis.disclaimer}
    </Text>

  </View>
)}
    </ScrollView>
    </SafeAreaView>
  );
}

// 🎨 Styles
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 20,
  },
  image: {
    width: 300,
    height: 300,
    resizeMode: "contain",
    marginVertical: 20,
  },
  responseBox: {
    marginTop: 20,
    padding: 15,
    borderColor: "#ddd",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: "#f9f9f9",
  },
  responseText: {
    fontSize: 16,
  },
  voiceThemeContainer: {
    marginBottom: 20,
    width: "100%",
  },
  voiceThemeTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  voiceThemeScroll: {
    maxHeight: 120,
  },
  voiceThemeOption: {
    padding: 10,
    marginHorizontal: 5,
    borderRadius: 10,
    alignItems: "center",
    minWidth: 100,
  },
  selectedVoiceTheme: {
    borderWidth: 3,
    borderColor: "#fff",
  },
  voiceThemeName: {
    color: "white",
    fontWeight: "bold",
    marginTop: 5,
  },
  voiceThemeDescription: {
    color: "white",
    fontSize: 10,
    textAlign: "center",
    marginTop: 2,
  },
  sectionTitle: {
  marginTop: 10,
  fontWeight: "bold",
  fontSize: 16,
},

disclaimer: {
  marginTop: 15,
  fontSize: 12,
  color: "gray",
  fontStyle: "italic",
},
});
