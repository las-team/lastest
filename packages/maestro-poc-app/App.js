import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View, Pressable } from "react-native";

// Minimal test target for the Maestro PoC. testID props give Maestro stable
// selectors (id: ...) so the flow doesn't depend on rendered text/coordinates.
export default function App() {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.container} testID="home-screen">
      <Text style={styles.title} testID="title">
        Lastest Maestro PoC
      </Text>

      <Text style={styles.counter} testID="counter-value">
        Count: {count}
      </Text>

      <Pressable
        testID="increment-button"
        style={styles.button}
        onPress={() => setCount((c) => c + 1)}
      >
        <Text style={styles.buttonText}>Increment</Text>
      </Pressable>

      <Pressable
        testID="reset-button"
        style={[styles.button, styles.resetButton]}
        onPress={() => setCount(0)}
      >
        <Text style={styles.buttonText}>Reset</Text>
      </Pressable>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  counter: {
    fontSize: 20,
  },
  button: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  resetButton: {
    backgroundColor: "#6b7280",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
});
