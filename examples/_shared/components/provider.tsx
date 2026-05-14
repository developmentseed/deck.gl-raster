import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { system } from "../styles/theme.js";

/**
 * Wraps an example app with the shared Chakra theme.
 *
 * Use in `main.tsx`: `root.render(<ExampleProvider><App /></ExampleProvider>)`.
 */
export function ExampleProvider({ children }: { children: ReactNode }) {
  return <ChakraProvider value={system}>{children}</ChakraProvider>;
}
