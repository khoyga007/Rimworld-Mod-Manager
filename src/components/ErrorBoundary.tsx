import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: string;
  stack: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "", stack: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error: error.message || "Unknown error",
      stack: error.stack || "",
    };
  }

  componentDidCatch(error: Error, info: any) {
    console.error("[ErrorBoundary] Caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          flexDirection: "column",
          gap: 24,
          padding: 40,
          textAlign: "center",
          background: "#0a0a0f",
          color: "#fff",
        }}>
          <div style={{ fontSize: 64 }}>💥</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: "#e74c3c" }}>
            RIMPRO Crashed
          </h2>
          <p style={{ color: "#888", maxWidth: 600, lineHeight: 1.6, fontSize: 14 }}>
            Something went wrong while rendering. This is a bug — please share the error below with the developer.
          </p>
          <div style={{
            background: "rgba(231, 76, 60, 0.1)",
            border: "1px solid rgba(231, 76, 60, 0.3)",
            borderRadius: 12,
            padding: "16px 20px",
            maxWidth: 700,
            width: "100%",
            textAlign: "left",
            fontSize: 12,
            fontFamily: "monospace",
            color: "#e74c3c",
            maxHeight: 200,
            overflow: "auto",
          }}>
            <strong>Error:</strong> {this.state.error}
            {this.state.stack && (
              <pre style={{ marginTop: 8, color: "#999", whiteSpace: "pre-wrap", fontSize: 11 }}>
                {this.state.stack}
              </pre>
            )}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#e67e22",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🔄 Reload App
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`Error: ${this.state.error}\n${this.state.stack}`);
              }}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "1px solid #555",
                background: "transparent",
                color: "#ccc",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              📋 Copy Error
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
