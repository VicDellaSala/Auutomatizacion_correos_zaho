import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Atención | Control de correos",
  description: "Histórico de atención de correos de agentes",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
