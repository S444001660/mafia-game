// Edge Function: start-game
// يُستدعى من المضيف عند الضغط على "ابدأ اللعبة"
// يوزع الأدوار عشوائياً ويُنشئ سجل اللعبة

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLES_CONFIG: Record<string, { team: string; min_players: number }> = {
  godfather:    { team: 'mafia',   min_players: 0  },
  mafioso:      { team: 'mafia',   min_players: 0  },
  framer:       { team: 'mafia',   min_players: 0  },
  consigliere:  { team: 'mafia',   min_players: 0  },
  doctor:       { team: 'town',    min_players: 0  },
  sheriff:      { team: 'town',    min_players: 0  },
  bodyguard:    { team: 'town',    min_players: 0  },
  mayor:        { team: 'town',    min_players: 0  },
  medium:       { team: 'town',    min_players: 0  },
  citizen:      { team: 'town',    min_players: 0  },
  jester:       { team: 'neutral', min_players: 0  },
  sk:           { team: 'neutral', min_players: 0  },
  executioner:  { team: 'neutral', min_players: 0  },
  witch:        { team: 'neutral', min_players: 0  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { room_id } = await req.json();
    if (!room_id) throw new Error('room_id required');

    // Get room + players
    const { data: room } = await supabase
      .from('rooms').select('*, room_players(player_id)').eq('id', room_id).single();
    if (!room) throw new Error('Room not found');

    const players: string[] = room.room_players.map((p: any) => p.player_id);
    const s = room.settings;
    const n = players.length;

    if (n < 4) throw new Error('Minimum 4 players required');

    // Build role pool
    const rolePool: string[] = [];

    // Mafia
    const mafiaCount = s.mafia_count || Math.max(1, Math.floor(n / 4));
    rolePool.push('godfather');
    for (let i = 1; i < mafiaCount; i++) {
      if (s.has_framer && rolePool.filter(r => r === 'framer').length === 0) rolePool.push('framer');
      else if (s.has_consigliere && rolePool.filter(r => r === 'consigliere').length === 0) rolePool.push('consigliere');
      else rolePool.push('mafioso');
    }

    // Special town
    if (s.has_doctor)    rolePool.push('doctor');
    if (s.has_sheriff)   rolePool.push('sheriff');
    if (s.has_bodyguard) rolePool.push('bodyguard');
    if (s.has_mayor)     rolePool.push('mayor');
    if (s.has_medium)    rolePool.push('medium');

    // Neutral
    if (s.has_jester)      rolePool.push('jester');
    if (s.has_sk)          rolePool.push('sk');
    if (s.has_executioner) rolePool.push('executioner');
    if (s.has_witch)       rolePool.push('witch');

    // Fill remaining with citizens
    while (rolePool.length < n) rolePool.push('citizen');

    // Shuffle
    for (let i = rolePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
    }

    // Shuffle players
    const shuffledPlayers = [...players];
    for (let i = shuffledPlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledPlayers[i], shuffledPlayers[j]] = [shuffledPlayers[j], shuffledPlayers[i]];
    }

    // Create game
    const phaseEndsAt = new Date(Date.now() + (s.day_duration || 120) * 1000).toISOString();
    const { data: game, error: gameErr } = await supabase
      .from('games')
      .insert({ room_id, phase: 'day', day_number: 1, phase_ends_at: phaseEndsAt })
      .select().single();
    if (gameErr) throw gameErr;

    // Assign roles to players
    const gamePlayers = shuffledPlayers.map((playerId, idx) => {
      const role = rolePool[idx];
      const team = ROLES_CONFIG[role].team;
      return { game_id: game.id, player_id: playerId, role, team };
    });

    // Find executioner target (random town player)
    const executionerIdx = gamePlayers.findIndex(p => p.role === 'executioner');
    if (executionerIdx !== -1) {
      const townPlayers = gamePlayers.filter(p => p.team === 'town');
      if (townPlayers.length > 0) {
        const target = townPlayers[Math.floor(Math.random() * townPlayers.length)];
        gamePlayers[executionerIdx] = {
          ...gamePlayers[executionerIdx],
          executioner_target: target.player_id
        } as any;
      }
    }

    const { error: gpErr } = await supabase.from('game_players').insert(gamePlayers);
    if (gpErr) throw gpErr;

    // Update room status
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', room_id);

    // System message
    await supabase.from('messages').insert({
      game_id: game.id,
      sender_id: shuffledPlayers[0],
      content: '🎮 بدأت اللعبة! تحقق من دورك وابدأ بالنقاش.',
      channel: 'system'
    });

    return new Response(JSON.stringify({ game_id: game.id, success: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
});
