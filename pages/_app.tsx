import '@/styles/globals.css';
import '@/styles/route-map.css';
import '@/styles/places-map.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
