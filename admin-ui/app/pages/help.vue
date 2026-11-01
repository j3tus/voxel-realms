<template>
  <div>
    <div class="page-h"><div><h1>Help</h1><p>Where things are, and every command you can use in game or in the console</p></div></div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><div class="card-h"><h3>Quick start</h3></div><ol class="hl">
        <li><b>Games</b> → <i>Set up game hub</i> creates the lobby and one world per mode. <i>New room</i> pins a room with its own player cap and bots; <i>New world</i> makes a regular world.</li>
        <li><b>Settings</b> sets the server name, message of the day and an optional join password. The admin password lives in the server's <code>ADMIN_PASSWORD</code> environment variable.</li>
        <li>Rooms open and close by themselves as games fill up. The <b>capacity</b> meter shows how many player slots the server can still carry and why it is limited.</li>
        <li>Make a <b>Backup</b> before risky changes. Worlds autosave every 30 s.</li></ol></div>
      <div class="card"><div class="card-h"><h3>What each page does</h3></div><ul class="hl">
        <li><b>Overview</b> live health, live games, capacity, charts, Save all / Backup / Announce / Maintenance.</li>
        <li><b>Games</b> every world and room, live state, lobby portal switch, backups. <b>Bots</b> global and per-game bot controls, summon and clear.</li>
        <li><b>Players</b> click a name for details; kick, ban, mute, op, coins, teleport. <b>Live map</b> block-accurate map with players and creatures.</li>
        <li><b>Economy</b> leaderboard, bounties, market prices and wallets. <b>Security</b> maintenance, allowlist, bans, audit log.</li></ul></div>
    </div>
    <div class="grid g3">
      <div class="card"><div class="card-h"><h3>Players</h3></div><ul class="cm"><li><code>/rooms [mode]</code> open games</li><li><code>/quick [mode]</code> jump into the best room</li><li><code>/join &lt;code|mode&gt;</code></li><li><code>/create &lt;mode&gt; [players] [bots] [skill] [public]</code></li><li><code>/lobby</code> · <code>/party</code> · <code>/msg &lt;p&gt; text</code></li><li><code>/ping</code> · <code>/stats</code> · <code>/list</code> · <code>/help</code></li></ul></div>
      <div class="card"><div class="card-h"><h3>Operators</h3></div><ul class="cm"><li><code>/kick /ban /unban /op /deop /mute /unmute</code></li><li><code>/heal [p]</code> · <code>/bring &lt;p&gt;</code> · <code>/tp x y z|p</code></li><li><code>/round start|end|restart</code></li><li><code>/room create|close|list</code></li><li><code>/announce text</code> · <code>/say text</code></li><li><code>/capacity</code> · <code>/status</code> · <code>/save</code></li></ul></div>
      <div class="card"><div class="card-h"><h3>Bots &amp; world</h3></div><ul class="cm"><li><code>/bot add [n] [skill] [name]</code> summon</li><li><code>/bot count n</code> · <code>/bot auto</code> · <code>/bot skill lvl</code></li><li><code>/bot pause|resume|clear|remove [n]|list</code></li><li><code>/time day|night</code> · <code>/weather clear|rain|storm</code></li><li><code>/spawn pig|zombie|villager|boss [n]</code> · <code>/kill mobs</code></li><li><code>/give &lt;p&gt; coins</code> · <code>/seed</code></li></ul></div>
    </div>
  </div>
</template>
<style scoped>
.hl, .cm { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 9px; font-size: 13.5px; color: var(--mut) } .hl b, .hl i { color: var(--txt); font-style: normal }
.cm { list-style: none; padding: 0 } code { background: rgba(255, 255, 255, .06); padding: 1px 6px; border-radius: 6px; font: 12px var(--mono); color: var(--acc) }
</style>
