// Global variables
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreElement = document.getElementById('score');
const healthValueElement = document.getElementById('health-value');
const healthBarElement = document.getElementById('health-bar');
const weaponStatusElement = document.getElementById('weapon-status');
const messagesDiv = document.getElementById('game-messages');
const messageTitle = document.getElementById('message-title');
const messageScore = document.getElementById('message-score');

let gameLoopId;
let isGameOver = false;

// Game Configuration
const PLAYER_SIZE = 20;
const PLAYER_SPEED = 5;
const BULLET_SIZE = 5;
const BULLET_SPEED = 10;
const ZOMBIE_SIZE = 25;
const ZOMBIE_SPEED = 1.5;
const ZOMBIE_SPAWN_INTERVAL = 1500; // milliseconds
const MAX_HEALTH = 100;
const ZOMBIE_DAMAGE = 10;

// New Configuration for Items
const ITEM_SIZE = 15;
const UPGRADE_DURATION = 10000; // 10 seconds in ms
const UPGRADE_CHANCE = 0.50;
const ITEM_LIFETIME = 15000; // 15 seconds lifetime for item
const WARNING_TIME = 5000; // Flicker starts at 5 seconds remaining
const DAMAGE_BOOST_MULTIPLIER = 1.5; // NEW: 50% increased damage (1.5x)

// Game State
let player;
let bullets = [];
let zombies = [];
let items = []; // New array for items
let score = 0;
let lastZombieSpawnTime = 0;

// Input State
let keys = { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false };
let mouse = { x: 0, y: 0, isFiring: false };

// --- Audio Global Variables ---
let shotSynth;
let hitSynth;
let itemSynth;
let bgmLoop;
let isAudioSetup = false;

// --- Audio Functions ---

function setupAudio() {
    if (isAudioSetup) return;

    // 1. Synth for Player Shot (Quick pluck sound)
    shotSynth = new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 4,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.1 },
    }).toDestination();

    // 2. Synth for Zombie Hit/Death (Noise burst)
    hitSynth = new Tone.NoiseSynth({
        noise: { type: 'brown' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
    }).toDestination();

    // 3. Synth for Item Collection (Simple chime)
    itemSynth = new Tone.Synth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.0, release: 0.5 }
    }).toDestination();

    // 4. Background Music (Simple dark loop)
    const bgmSynth = new Tone.Synth().toDestination();
    bgmSynth.oscillator.type = 'sawtooth';
    bgmSynth.volume.value = -18; // Keep BGM volume low

    const notes = ["C3", "G3", "A#3", "F3"];
    let index = 0;
    bgmLoop = new Tone.Loop(time => {
        const note = notes[index % notes.length];
        bgmSynth.triggerAttackRelease(note, "0.5n", time);
        index++;
    }, "1n").start(0); // Loop every 1 note

    Tone.Transport.bpm.value = 80;
    isAudioSetup = true;
}

function startBGM() {
    // Start the Tone.js transport only if not running
    if (Tone.Transport.state !== 'started') {
        Tone.Transport.start();
    }
}

function stopBGM() {
    if (Tone.Transport.state === 'started') {
        Tone.Transport.stop();
    }
}

function playShotSFX() {
    if (shotSynth && Tone.context.state === 'running') {
        // Play a quick, short sound
        shotSynth.triggerAttackRelease("C4", "32n");
    }
}

function playHitSFX() {
    if (hitSynth && Tone.context.state === 'running') {
        // Play a noise burst for hit/death
        hitSynth.triggerAttackRelease("8n");
    }
}

function playItemSFX() {
    if (itemSynth && Tone.context.state === 'running') {
        // Play a chime sound for item collection
        itemSynth.triggerAttackRelease("E5", "8n");
    }
}
// --- End Audio Functions ---

// --- Utility Functions ---

/**
 * Calculates distance between two points.
 */
function dist(x1, y1, x2, y2) {
    // FIX: Corrected the formula for distance calculation
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

/**
 * Updates the score and health display on the UI, and weapon status.
 */
function updateStatsDisplay() {
    scoreElement.textContent = score;
    healthValueElement.textContent = Math.max(0, player.health);
    healthBarElement.value = Math.max(0, player.health);

    if (player.health <= 30) {
        healthBarElement.style.accentColor = '#e94560'; // Low health color (Red)
    } else {
        healthBarElement.style.accentColor = '#00ffff'; // Normal color (Cyan)
    }

    // Weapon Status Display (support stacked effects)
    const statuses = [];
    const now = Date.now();
    if (player.tripleShotEndTime > now) {
        const remaining = Math.max(0, Math.floor((player.tripleShotEndTime - now) / 1000));
        statuses.push(`Triple Shot: ${remaining}s`);
    }
    if (player.damageBoostEndTime > now) {
        const remaining = Math.max(0, Math.floor((player.damageBoostEndTime - now) / 1000));
        statuses.push(`Damage Boost: ${remaining}s`);
    }
    weaponStatusElement.textContent = statuses.join(' | ');
}

// --- Game Object Classes ---

/**
 * Player Class (The Hero)
 */
class Player {
    constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.health = MAX_HEALTH;
        this.color = '#00ffff';

        // Weapon/Upgrade State
        this.lastShotTime = 0;
        this.tripleShotEndTime = 0;
        this.damageBoostEndTime = 0;
        this.currentShotDelay = 200; // ms (Default Rate of fire)
        this.defaultShotDelay = 200;
        this.bulletDamageMultiplier = 1; // Default damage multiplier is 1
    }

    draw() {
        ctx.save();

        // Player Body
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Draw the weapon/direction line (towards the mouse/aim)
        const angle = Math.atan2(mouse.y - this.y, mouse.x - this.x);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(
            this.x + Math.cos(angle) * (this.size / 2 + 10),
            this.y + Math.sin(angle) * (this.size / 2 + 10)
        );
        ctx.stroke();

        ctx.restore();
    }

    update() {
        let dx = 0;
        let dy = 0;

        // Desktop (WASD or Arrow Keys)
        if (keys.w || keys.up) dy -= PLAYER_SPEED;
        if (keys.s || keys.down) dy += PLAYER_SPEED;
        if (keys.a || keys.left) dx -= PLAYER_SPEED;
        if (keys.d || keys.right) dx += PLAYER_SPEED;

        // Mobile (Joystick Movement)
        if (joystickState.active) {
            dx += joystickState.dx * PLAYER_SPEED;
            dy += joystickState.dy * PLAYER_SPEED;
        }

        // Normalize diagonal movement speed
        if (dx !== 0 && dy !== 0) {
            const magnitude = Math.sqrt(dx * dx + dy * dy);
            dx = (dx / magnitude) * PLAYER_SPEED;
            dy = (dy / magnitude) * PLAYER_SPEED;
        }

        this.x += dx;
        this.y += dy;

        // Keep player within bounds
        this.x = Math.max(this.size / 2, Math.min(canvas.width - this.size / 2, this.x));
        this.y = Math.max(this.size / 2, Math.min(canvas.height - this.size / 2, this.y));

        const now = Date.now();
        // Update active upgrade effects (supports stacking)
        const tripleActive = this.tripleShotEndTime > now;
        const damageBoostActive = this.damageBoostEndTime > now;

        this.currentShotDelay = tripleActive ? 300 : this.defaultShotDelay;
        this.bulletDamageMultiplier = damageBoostActive ? DAMAGE_BOOST_MULTIPLIER : 1;

        if (mouse.isFiring) {
            this.shoot();
        }

        updateStatsDisplay();
    }

    /**
     * Applies a weapon upgrade or collects an item.
     */
    applyUpgrade(type) {
        if (type === 'health_pack') {
            const healthRestored = 30; // Restore 30 health
            this.health = Math.min(MAX_HEALTH, this.health + healthRestored);
            // Health pack is instantaneous, no timed duration
            return;
        }

        // --- Weapon Upgrades (Timed) --- (allow stacking)
        if (type === 'triple_shot') {
            this.tripleShotEndTime = Date.now() + UPGRADE_DURATION;
            this.currentShotDelay = 300;
        } else if (type === 'damage_boost') {
            this.damageBoostEndTime = Date.now() + UPGRADE_DURATION;
        }
    }

    /**
     * Helper function to create a single bullet.
     */
    _createBullet(angle) {
        const bullet = new Bullet(
            this.x + Math.cos(angle) * (this.size / 2 + 5),
            this.y + Math.sin(angle) * (this.size / 2 + 5),
            BULLET_SIZE,
            angle
        );
        bullets.push(bullet);
    }

    shoot() {
        const now = Date.now();
        if (now - this.lastShotTime > this.currentShotDelay) {
            const angle = Math.atan2(mouse.y - this.y, mouse.x - this.x);

            const tripleActive = this.tripleShotEndTime > now;

            if (!tripleActive) {
                this._createBullet(angle);
            } else {
                // Fire three bullets in a spread (approx +/- 10 degrees spread)
                const spread = 0.35; // Angle in radians
                this._createBullet(angle - spread);
                this._createBullet(angle);
                this._createBullet(angle + spread);
            }

            playShotSFX(); // Play shot sound effect
            this.lastShotTime = now;
        }
    }
}

/**
 * Bullet Class
 */
class Bullet {
    constructor(x, y, size, angle) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.vx = Math.cos(angle) * BULLET_SPEED;
        this.vy = Math.sin(angle) * BULLET_SPEED;
        this.color = 'yellow';
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
        ctx.fill();
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
    }

    isOffScreen() {
        return this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height;
    }
}

/**
 * Zombie Class (The Enemy)
 */
class Zombie {
    constructor(x, y, size) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.color = '#e94560'; // Zombie red
        this.initialHealth = 30;
        this.health = this.initialHealth; // 2-3 shots to kill
    }

    draw() {
        ctx.save();

        // Zombie Body (Square for a more menacing look)
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);

        // Draw health bar
        const healthBarWidth = this.size;
        const healthBarHeight = 3;
        const currentHealthRatio = this.health / this.initialHealth;

        // Background (Red)
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.fillRect(this.x - healthBarWidth / 2, this.y - this.size / 2 - healthBarHeight - 2, healthBarWidth, healthBarHeight);

        // Foreground (Lime)
        ctx.fillStyle = 'lime';
        ctx.fillRect(this.x - healthBarWidth / 2, this.y - this.size / 2 - healthBarHeight - 2, healthBarWidth * currentHealthRatio, healthBarHeight);

        ctx.restore();
    }

    update() {
        // Pathfinding: move directly towards the player
        const angle = Math.atan2(player.y - this.y, player.x - this.x);
        this.x += Math.cos(angle) * ZOMBIE_SPEED;
        this.y += Math.sin(angle) * ZOMBIE_SPEED;

        // Check for collision with player
        if (dist(this.x, this.y, player.x, player.y) < this.size / 2 + player.size / 2) {
            this.attackPlayer();
        }
    }

    lastAttackTime = 0;
    ATTACK_DELAY = 1000; // ms (Zombie attacks every 1 second)

    attackPlayer() {
        const now = Date.now();
        if (now - this.lastAttackTime > this.ATTACK_DELAY) {
            player.health -= ZOMBIE_DAMAGE;
            this.lastAttackTime = now;
            if (player.health <= 0) {
                gameOver();
            }
        }
    }
}

/**
 * Item Class (Power-ups) - New Class
 */
class Item {
    constructor(x, y, size, type) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.type = type; // e.g., 'triple_shot', 'health_pack', 'damage_boost'
        this.creationTime = Date.now(); // Timestamp for item expiry
    }

    draw() {
        const now = Date.now();
        const elapsedTime = now - this.creationTime;
        const remainingTime = ITEM_LIFETIME - elapsedTime;

        let showItem = true;

        // Flicker warning logic
        if (remainingTime < WARNING_TIME) {
            // Flicker period is 200ms (on for 100ms, off for 100ms)
            const flickerInterval = 200;
            if (Math.floor(now / 100) % 2 === 0) {
                // Hide item half the time during warning period
                showItem = false;
            } else {
                showItem = true;
            }
        }

        if (!showItem) return; // Skip drawing if hidden by flicker

        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;

        if (this.type === 'triple_shot') {
            // Triple Shot: Green Arrow
            ctx.fillStyle = '#3DDC84';
            ctx.beginPath();
            ctx.moveTo(this.x, this.y - this.size / 2); // Top center
            ctx.lineTo(this.x + this.size / 2, this.y + this.size / 2); // Bottom right
            ctx.lineTo(this.x - this.size / 2, this.y + this.size / 2); // Bottom left
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

        } else if (this.type === 'health_pack') {
            // Health Pack: Red Cross
            const red = '#ff0000';
            const white = '#ffffff';

            // Draw a red square background
            ctx.fillStyle = red;
            ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);

            // Draw a white cross
            ctx.fillStyle = white;
            const crossWidth = this.size * 0.2;
            const crossLength = this.size * 0.7;

            // Vertical bar
            ctx.fillRect(this.x - crossWidth / 2, this.y - crossLength / 2, crossWidth, crossLength);
            // Horizontal bar
            ctx.fillRect(this.x - crossLength / 2, this.y - crossWidth / 2, crossLength, crossWidth);

            // Draw border
            ctx.strokeStyle = white;
            ctx.strokeRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
        } else if (this.type === 'damage_boost') { // NEW: Yellow Star for Damage Boost
            ctx.fillStyle = '#FFD700'; // Gold/Yellow
            ctx.beginPath();

            // Simple 5-pointed star approximation
            const outerRadius = this.size / 2;
            const innerRadius = this.size / 4;

            for (let i = 0; i < 5; i++) {
                let outerAngle = (Math.PI / 2) - i * (2 * Math.PI / 5);
                let innerAngle = outerAngle + Math.PI / 5;

                ctx.lineTo(this.x + outerRadius * Math.cos(outerAngle), this.y - outerRadius * Math.sin(outerAngle));
                ctx.lineTo(this.x + innerRadius * Math.cos(innerAngle), this.y - innerRadius * Math.sin(innerAngle));
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }
}

// --- Game Logic ---

/**
 * Resizes the canvas to be square and responsive.
 */
function resizeCanvas() {
    // 800px max, 90vw for smaller screens
    const size = Math.min(window.innerWidth * 0.9, 800);
    canvas.width = size;
    canvas.height = size;

    // Recenter player on resize
    if (player) {
        player.x = canvas.width / 2;
        player.y = canvas.height / 2;
    }
    // Set initial mouse position to the center for aim reference
    getMousePos({ clientX: canvas.width / 2, clientY: canvas.height / 2 });
}

/**
 * Spawns a zombie randomly from one of the four sides outside the canvas.
 */
function spawnZombie() {
    const side = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
    let x, y;

    if (side === 0) { // Top
        x = Math.random() * canvas.width;
        y = -ZOMBIE_SIZE;
    } else if (side === 1) { // Right
        x = canvas.width + ZOMBIE_SIZE;
        y = Math.random() * canvas.height;
    } else if (side === 2) { // Bottom
        x = Math.random() * canvas.width;
        y = canvas.height + ZOMBIE_SIZE;
    } else { // Left
        x = -ZOMBIE_SIZE;
        y = Math.random() * canvas.height;
    }

    zombies.push(new Zombie(x, y, ZOMBIE_SIZE));
}

/**
 * Updates all game logic: movement, spawning, and collisions.
 */
function updateGame() {
    if (isGameOver) return;

    // 1. Spawning Logic: Increase difficulty by reducing spawn interval
    const now = Date.now();
    const spawnRateReduction = Math.min(score * 8, 1000); // Max reduction of 1000ms
    const currentSpawnInterval = ZOMBIE_SPAWN_INTERVAL - spawnRateReduction;

    if (now - lastZombieSpawnTime > currentSpawnInterval) {
        spawnZombie();
        lastZombieSpawnTime = now;
    }

    // 2. Update entities
    player.update();
    bullets.forEach(bullet => bullet.update());
    zombies.forEach(zombie => zombie.update());
    // Items don't move, no update needed

    // 3. Item Expiry and Player vs Item Collision Detection
    items = items.filter(item => {
        const now = Date.now();

        // Check for expiry (15 seconds)
        if (now - item.creationTime > ITEM_LIFETIME) {
            return false; // Remove expired item
        }

        // Check for player collection collision
        if (dist(player.x, player.y, item.x, item.y) < player.size / 2 + item.size / 2) {
            player.applyUpgrade(item.type);
            playItemSFX(); // Play item collected sound
            return false; // Remove item (Collected)
        }
        return true; // Keep item
    });

    // 4. Collision Detection (Bullet vs Zombie)
    bullets = bullets.filter(bullet => {
        let hit = false;
        zombies = zombies.filter(zombie => {
            if (dist(bullet.x, bullet.y, zombie.x, zombie.y) < bullet.size / 2 + zombie.size / 2) {
                // Hit!
                const damage = 10 * player.bulletDamageMultiplier; // CHANGED: Use player damage multiplier
                zombie.health -= damage; // Apply calculated damage
                if (zombie.health <= 0) {
                    score += 10;
                    playHitSFX(); // Play zombie death sound

                    // --- Item Drop Logic (50% chance) ---
                    if (Math.random() < UPGRADE_CHANCE) {
                        // CHANGED: Added 'damage_boost'
                        const itemTypes = ['triple_shot', 'health_pack', 'damage_boost'];
                        const randomType = itemTypes[Math.floor(Math.random() * itemTypes.length)];

                        const newItem = new Item(zombie.x, zombie.y, ITEM_SIZE, randomType);
                        items.push(newItem);
                    }
                    // --- End Item Drop Logic ---

                    return false; // Remove zombie (Killed)
                }
                hit = true; // Bullet disappears
                return true; // Keep zombie
            }
            return true; // Keep zombie
        });
        return !hit && !bullet.isOffScreen(); // Keep bullet if it didn't hit and is on screen
    });

    // 5. Check Game Over
    if (player.health <= 0) {
        gameOver();
    }
}

/**
 * Clears the canvas and redraws all game entities.
 */
function drawGame() {
    // Clear canvas (background)
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw all entities
    player.draw();
    bullets.forEach(bullet => bullet.draw());
    zombies.forEach(zombie => zombie.draw());
    items.forEach(item => item.draw()); // Draw items

    // Draw the weapon aiming line on top of items for better visibility
    player.draw();
}

/**
 * The main game loop using requestAnimationFrame.
 */
function gameLoop() {
    updateGame();
    drawGame();
    if (!isGameOver) {
        gameLoopId = requestAnimationFrame(gameLoop);
    }
}

/**
 * Handles the click event for both initial start and play again.
 * This function also handles the browser-mandated audio context start.
 */
function handleStartAudioAndGame() {
    // 1. Ensure audio context is resumed/started on user gesture (click)
    setupAudio();
    Tone.start().then(() => {
        startBGM(); // Start BGM after context is running
    });

    // 2. Hide the message box and start the game
    initGame();
}

/**
 * Sets the game to an over state and displays the score message.
 */
function gameOver() {
    isGameOver = true;
    stopBGM(); // Stop BGM on game over
    cancelAnimationFrame(gameLoopId);

    const controlButton = document.getElementById('gameControlButton');

    messageTitle.textContent = 'เกมโอเวอร์! (Game Over!)';
    messageScore.textContent = `คะแนนสุดท้าย: ${score}`;
    controlButton.textContent = 'เล่นใหม่'; // Change button text for replay

    messagesDiv.style.visibility = 'visible';
    messagesDiv.style.display = 'flex';
    // The button onclick attribute already points to handleStartAudioAndGame()
}

/**
 * Resets the game state and starts the game loop.
 */
function initGame() {
    // *** FIX: Reset all input states to prevent unwanted movement on start ***
    keys = { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false };
    mouse = { x: 0, y: 0, isFiring: false };
    resetJoystick();
    // ************************************************************************

    // Reset state
    isGameOver = false;
    // Ensure player is created after canvas resize
    player = new Player(canvas.width / 2, canvas.height / 2, PLAYER_SIZE);
    bullets = [];
    zombies = [];
    items = []; // Reset items array
    score = 0;
    lastZombieSpawnTime = 0;

    // Reset message box
    messagesDiv.style.visibility = 'hidden';
    messagesDiv.style.display = 'none';

    // Reset stats
    updateStatsDisplay();

    // Start game loop
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    gameLoopId = requestAnimationFrame(gameLoop);
}

// --- Input Handlers (Desktop) ---

document.addEventListener('keydown', (e) => {
    if (isGameOver) return;
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    if (e.key === 'ArrowUp') keys.up = true;
    if (e.key === 'ArrowDown') keys.down = true;
    if (e.key === 'ArrowLeft') keys.left = true;
    if (e.key === 'ArrowRight') keys.right = true;
});

document.addEventListener('keyup', (e) => {
    if (isGameOver) return;
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
    if (e.key === 'ArrowUp') keys.up = false;
    if (e.key === 'ArrowDown') keys.down = false;
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
});

/**
 * Calculates mouse position relative to the canvas.
 */
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    // Calculate normalized coordinates relative to canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouse.x = (e.clientX - rect.left) * scaleX;
    mouse.y = (e.clientY - rect.top) * scaleY;
}

canvas.addEventListener('mousemove', getMousePos);
canvas.addEventListener('mousedown', () => { if (!isGameOver) mouse.isFiring = true; });
document.addEventListener('mouseup', () => { mouse.isFiring = false; });

// --- Input Handlers (Mobile/Touch) ---

const fireButton = document.getElementById('fireButton');
const joystick = document.getElementById('joystick');
const joystickHandle = joystick.querySelector('.joystick-handle');
const joystickState = { active: false, startX: 0, startY: 0, dx: 0, dy: 0 };
const joystickRadius = 50;

// Touch Fire Button
fireButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!isGameOver) mouse.isFiring = true;
    // Set aim to player's center if no dedicated aim touch is active
    if (!touchAimState.active) {
        mouse.x = player.x;
        mouse.y = player.y;
    }
});
fireButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    mouse.isFiring = false;
});

// Touch aiming state (for aiming outside of joystick/fire buttons)
let touchAimState = { active: false, touchId: null };

// Main touch handler for canvas (only handles aiming/mouse position update)
canvas.addEventListener('touchstart', (e) => {
    // Only capture a touch for aiming if the joystick is NOT active
    if (isGameOver || joystickState.active || touchAimState.active) return;

    // Check if the touch is far away from the controls area (rough check)
    const touch = e.changedTouches[0];
    const rect = canvas.getBoundingClientRect();
    const isNearControls = touch.clientY > (rect.bottom - 150); // Check if touch is near bottom 150px

    if (!isNearControls) {
        e.preventDefault();
        touchAimState.active = true;
        touchAimState.touchId = touch.identifier;
        getMousePos(touch);
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (isGameOver) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchAimState.touchId) {
            e.preventDefault();
            getMousePos(touch);
            break;
        }
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    // Clear touch aiming
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchAimState.touchId) {
            touchAimState.active = false;
            touchAimState.touchId = null;
            break;
        }
    }
});

// Joystick logic
let activeJoystickTouchId = null;

joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (isGameOver) return;

    const touch = e.changedTouches[0];
    const rect = joystick.getBoundingClientRect();

    joystickState.active = true;
    activeJoystickTouchId = touch.identifier;
    // Calculate the center of the joystick on screen
    joystickState.startX = rect.left + rect.width / 2;
    joystickState.startY = rect.top + rect.height / 2;

    updateJoystick(touch.clientX, touch.clientY);
});

document.addEventListener('touchmove', (e) => {
    if (isGameOver) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeJoystickTouchId) {
            e.preventDefault();
            updateJoystick(touch.clientX, touch.clientY);
            break;
        }
    }
}, { passive: false });

document.addEventListener('touchend', (e) => {
    if (isGameOver) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeJoystickTouchId) {
            resetJoystick();
            break;
        }
    }
});

/**
 * Updates the joystick movement state and handle position.
 */
function updateJoystick(currentX, currentY) {
    const dxRaw = currentX - joystickState.startX;
    const dyRaw = currentY - joystickState.startY;
    const distance = Math.min(dist(0, 0, dxRaw, dyRaw), joystickRadius);
    const angle = Math.atan2(dyRaw, dxRaw);

    // Set normalized movement vectors (from -1 to 1)
    joystickState.dx = distance / joystickRadius * Math.cos(angle);
    joystickState.dy = distance / joystickRadius * Math.sin(angle);

    // Update handle position (moves up to 50% of the joystick's radius)
    joystickHandle.style.transform = `translate(${joystickState.dx * (joystickRadius * 0.5)}px, ${joystickState.dy * (joystickRadius * 0.5)}px)`;
}

/**
 * Resets the joystick state.
 */
function resetJoystick() {
    joystickState.active = false;
    activeJoystickTouchId = null;
    joystickState.dx = 0;
    joystickState.dy = 0;
    joystickHandle.style.transform = 'translate(0, 0)';
}

// --- Initialization ---

window.addEventListener('load', () => {
    // Initial setup
    resizeCanvas();
    // Set up resize listener
    window.addEventListener('resize', resizeCanvas);

    // Set initial text for the start screen
    document.getElementById('message-title').textContent = 'เกมยิงซอมบี้';
    document.getElementById('message-score').textContent = 'WASD/ลูกศรเพื่อเคลื่อนที่, คลิกซ้ายเพื่อยิง';
    document.getElementById('gameControlButton').textContent = 'เริ่มเล่น';

    // We do NOT call initGame() here. The user click on the button will start the game and the audio.
});
