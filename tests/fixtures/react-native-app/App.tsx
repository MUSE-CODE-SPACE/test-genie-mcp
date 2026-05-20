// Deliberately broken fixture: useEffect without cleanup → memory leak.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';

export function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => c + 1);
    }, 1000);
    // BUG: missing `return () => clearInterval(id)` → interval leaks across renders
  }, []);

  return (
    <View>
      <Text>{count}</Text>
    </View>
  );
}
