import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '@/lib/api-client';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (apiClient.isAuthenticated()) {
      router.replace('/chat');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh' 
    }}>
      <div>Loading...</div>
    </div>
  );
}
