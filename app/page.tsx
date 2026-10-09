import { CartProvider } from "@/lib/cart";
import { KioskScreen } from "@/components/KioskScreen";
import { VideoHero } from "@/components/VideoHero";

export default function Home() {
  return (
    <main className="bg-white">
      <VideoHero />
      <section id="demo" className="h-screen min-h-[600px] p-4">
        {/* The transform contains the mobile menu sheet (position: fixed) within this card. */}
        <div className="h-full rounded-[20px] overflow-hidden [transform:translateZ(0)]">
          <CartProvider>
            <KioskScreen />
          </CartProvider>
        </div>
      </section>
    </main>
  );
}
