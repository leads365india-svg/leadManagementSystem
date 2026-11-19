import { Inter } from "next/font/google"
import "./globals.css"
import Header from "@/components/header"
import Footer from "@/components/footer"
import { Toaster } from "react-hot-toast"
import { AuthProvider } from "@/lib/auth-context"
import AuthGuard from "@/components/auth-guard"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "LeadFlow - Lead Management System",
  description: "Streamline your sales process with comprehensive lead tracking and management",
  icons: {
    icon: "/favicon.svg",
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                window.addEventListener('error', function(e) {
                  var msg = (e && (e.message || (e.error && e.error.message))) || '';
                  if (msg.indexOf('ChunkLoadError') !== -1 || msg.indexOf('Loading chunk') !== -1) {
                    try {
                      var k = '__chunk_retry_ts';
                      var last = sessionStorage.getItem(k);
                      var now = Date.now();
                      if (!last || now - parseInt(last, 10) > 10000) {
                        sessionStorage.setItem(k, now.toString());
                        window.location.reload();
                      }
                    } catch(err) {
                      window.location.reload();
                    }
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body className={`${inter.className} min-h-screen flex flex-col bg-slate-50 text-slate-800 antialiased max-w-full overflow-x-hidden`}>
        <AuthProvider>
          <Header />
          <main className="flex-1 w-full max-w-full min-w-0">
            <AuthGuard>{children}</AuthGuard>
          </main>
          <Footer />
        </AuthProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: "#1e293b",
              color: "#fff",
              borderRadius: "12px",
              padding: "12px 16px",
              fontSize: "13px",
              fontWeight: 500,
              boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            },
            success: {
              iconTheme: {
                primary: "#10b981",
                secondary: "#fff",
              },
            },
            error: {
              iconTheme: {
                primary: "#ef4444",
                secondary: "#fff",
              },
            },
          }}
        />
      </body>
    </html>
  )
}
