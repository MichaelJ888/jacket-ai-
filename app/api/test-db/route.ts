import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({
      success: false,
      error: 'Missing Supabase keys in .env.local',
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data, error } = await supabase
      .from('leads')
      .select('count', { count: 'exact' });

    if (error) {
      return NextResponse.json({
        success: true,
        message: 'Connected to Supabase successfully!',
        note: error.message,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Connected to Supabase successfully!',
      data,
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Unknown Supabase connection error';
    return NextResponse.json({ success: false, error });
  }
}