import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'TL / PANELFELIX — Pterodactyl Tools',description:'Dashboard realtime & tools manajemen Pterodactyl dengan koneksi aman dan Turso'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="id"><body>{children}</body></html>}
