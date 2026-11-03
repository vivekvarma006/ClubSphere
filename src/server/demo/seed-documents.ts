/**
 * Knowledge-base content for the demo clubs (fictional, written for this
 * project). Chosen so semantic search has something to prove: queries can
 * be phrased in different words from the documents they should find.
 */
export interface DemoDocument {
  club: "cyber-sec" | "robotics";
  title: string;
  sourceType: "event_doc" | "guide" | "writeup" | "feedback" | "minutes";
  visibility?: "members" | "officers";
  event?: "webWorkshop" | "ctf" | "race";
  body: string;
}

export const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    club: "cyber-sec",
    title: "Write-up: Bypassing the admin login",
    sourceType: "writeup",
    event: "webWorkshop",
    body: `The challenge showed a login form for an internal admin panel. The username field was inserted directly into a SQL query, so entering ' OR '1'='1' -- as the username made the WHERE clause always true and the application logged us in as the first user in the table, which was the administrator.

Lesson: never build SQL by concatenating user input. Parameterized queries (prepared statements) send the values separately from the SQL text, so the database never interprets them as code. Least-privilege database accounts limit the damage if a mistake slips through.`,
  },
  {
    club: "cyber-sec",
    title: "Write-up: Stored XSS in the guestbook",
    sourceType: "writeup",
    event: "webWorkshop",
    body: `The guestbook page rendered comments without escaping HTML. We posted a comment containing a script tag that read document.cookie and sent it to a server we controlled. When the bot playing the admin viewed the guestbook, its session cookie arrived on our server, and replaying that cookie gave us the admin's session and the flag.

Defences: escape output by default, mark session cookies HttpOnly so JavaScript cannot read them, and add a Content-Security-Policy that blocks inline scripts.`,
  },
  {
    club: "cyber-sec",
    title: "Write-up: Smashing the stack in echo-server",
    sourceType: "writeup",
    body: `echo-server copied our input into a 64-byte buffer with gets(), which performs no bounds checking. Sending 72 bytes of padding followed by an address overwrote the saved return address on the stack, so when the function returned, execution jumped to the hidden win() function that prints the flag.

Mitigations that would have stopped this: stack canaries, non-executable stacks, address space layout randomization (ASLR), and simply using fgets with a length limit.`,
  },
  {
    club: "cyber-sec",
    title: "Write-up: RSA with a tiny public exponent",
    sourceType: "writeup",
    body: `The ciphertext was produced with RSA using e = 3 and no padding. Because the message was short, m cubed was smaller than the modulus n, so no modular reduction happened at all. Taking the integer cube root of the ciphertext recovered the plaintext directly.

Takeaway: textbook RSA without padding is insecure. Real systems use OAEP padding, which randomizes the message before encryption.`,
  },
  {
    club: "cyber-sec",
    title: "Linux privilege escalation checklist",
    sourceType: "guide",
    body: `Once you have a low-privilege shell, enumerate before exploiting. Run sudo -l to see which commands you may run as root without a password. Search for SUID binaries with find / -perm -4000 and check them against GTFOBins. Look at cron jobs and writable scripts they execute, world-writable files in the PATH, and credentials left in configuration files or shell history.

Kernel exploits are a last resort: they can crash the machine. Always note the kernel version with uname -a first.`,
  },
  {
    club: "cyber-sec",
    title: "CyberQuest CTF 2026: rules and scoring",
    sourceType: "event_doc",
    event: "ctf",
    body: `Teams of up to three players. Challenges are worth between 100 and 500 points depending on difficulty, and the first team to solve a challenge earns a 10 percent bonus. Flags have the format CQ{...}. Do not attack the scoring server or other teams' machines; doing so means disqualification.

Check in at the Seminar Hall entrance by showing your QR code from the ClubSphere app. Lunch is served at 1 pm to checked-in participants only.`,
  },
  {
    club: "cyber-sec",
    title: "Getting started with Wireshark",
    sourceType: "guide",
    body: `Wireshark captures network packets so you can inspect protocols layer by layer. Start a capture on your network interface, then use display filters such as http, dns or tcp.port == 443 to narrow down the traffic. Follow TCP Stream reassembles a whole conversation, which is the quickest way to read credentials sent over unencrypted protocols like FTP or plain HTTP in forensics challenges.`,
  },
  {
    club: "cyber-sec",
    title: "Officer meeting minutes: October",
    sourceType: "minutes",
    visibility: "officers",
    body: `Budget: the CyberQuest prize pool is approved, and snacks will be bought from the club fund. Sneha will prepare the challenge server and Kiran will coordinate the volunteers at the check-in desk. We will review the pending membership applications before the CTF so new members can register.`,
  },
  {
    club: "cyber-sec",
    title: "Feedback summary: Web Exploitation Workshop",
    sourceType: "feedback",
    event: "webWorkshop",
    body: `Participants rated the workshop 4.4 out of 5 on average. The practice labs were the most appreciated part. Several people asked for more time on cross-site scripting and for the slides in advance. Two attendees found the pace too fast for first-year students, so next time we will run a separate beginner track.`,
  },
  {
    club: "robotics",
    title: "Tuning PID for a line follower",
    sourceType: "guide",
    event: "race",
    body: `A line follower reads an array of infrared sensors to estimate how far the robot has drifted from the black line. A PID controller turns that error into a steering correction: the proportional term reacts to the current error, the integral term removes steady drift, and the derivative term damps oscillation. Start with only Kp, increase it until the robot wobbles, then add Kd to smooth the wobble. Most tracks need little or no Ki.`,
  },
  {
    club: "robotics",
    title: "Line Follower Race rules",
    sourceType: "event_doc",
    event: "race",
    body: `Robots must be autonomous and fit inside a 20 cm by 20 cm square. Each team gets three attempts; the fastest complete lap counts. Leaving the track for more than two seconds ends the attempt. Batteries must be at most 12 volts.`,
  },
  {
    club: "robotics",
    title: "Arduino Bootcamp notes: motors and PWM",
    sourceType: "writeup",
    body: `An Arduino pin cannot supply enough current for a DC motor, so we use a motor driver such as the L298N. Pulse width modulation (PWM) switches the output on and off quickly; the fraction of time it is on, the duty cycle, sets the motor's average speed. analogWrite(pin, 128) gives roughly half speed.`,
  },
];
