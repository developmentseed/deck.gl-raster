import { Field as ChakraField } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface FieldProps {
  /** Label rendered above the control. */
  label: ReactNode;
  /** Optional helper text rendered below the control. */
  helperText?: ReactNode;
  /** The form control (e.g. a Chakra `NativeSelect`, `Checkbox`, or `Slider`). */
  children: ReactNode;
}

/**
 * A labeled form field — Chakra's `Field` with the example panel's small,
 * muted label styling.
 */
export function Field({ label, helperText, children }: FieldProps) {
  return (
    <ChakraField.Root>
      <ChakraField.Label fontSize="xs" color="gray.600">
        {label}
      </ChakraField.Label>
      {children}
      {helperText ? (
        <ChakraField.HelperText fontSize="xs" color="gray.600">
          {helperText}
        </ChakraField.HelperText>
      ) : null}
    </ChakraField.Root>
  );
}
