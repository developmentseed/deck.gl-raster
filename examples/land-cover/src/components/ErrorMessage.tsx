interface ErrorMessageProps {
  message: string;
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#ff4444",
        color: "white",
        padding: "12px 24px",
        borderRadius: "4px",
        maxWidth: "80%",
        pointerEvents: "auto",
      }}
    >
      Error: {message}
    </div>
  );
}
