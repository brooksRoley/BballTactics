// Coach Miller's Film Room — puzzle scenarios.
//
// Content ported verbatim from the BasketballTactics iOS app:
//   ~/Desktop/NBASwiftTactics/BasketballTactics/PuzzleModel.swift
//   (PuzzleManager.loadMockPuzzles())
//
// Player positions use the same arbitrary 800x800 coordinate system the iOS
// MiniCourtView renders against (PuzzleView.swift): the basket/baseline is at
// the top (small y), half-court is toward the bottom. Positions are copied
// exactly from the Swift `PuzzlePlayer(positionX:positionY:)` values.

// The five defensive coverages the iOS app teaches (DefensiveStrategy enum).
export const COVERAGES = {
  drop: 'Drop Coverage',
  ice: 'ICE / Down',
  switchAll: 'Switch All',
  blitz: 'Blitz / Trap',
  hardHedge: 'Hard Hedge',
};

export const FILM_ROOM_PUZZLES = [
  {
    id: '1',
    title: 'The Luka/Harden Dilemma',
    difficulty: 3,
    description:
      'You are defending a ball-dominant guard in a high Pick and Roll. The roll man is a non-shooting lob threat.',
    players: [
      { id: 1, name: 'Star Guard', x: 400, y: 150, isBallHandler: true,
        strengths: ['Elite Step-back 3', 'Elite Rim Finishing'], weaknesses: ['Inefficient short mid-range/floaters'] },
      { id: 2, name: 'Lob Threat', x: 400, y: 200, isBallHandler: false,
        strengths: ['95th percentile rim finishing', 'Elite screen setting'], weaknesses: ['Cannot shoot outside 5 feet'] },
    ],
    options: ['blitz', 'switchAll', 'drop', 'ice'],
    analyticsContext:
      'The ball handler generates 1.15 Points Per Possession (PPP) when they get to the rim or shoot step-back 3s, but only 0.85 PPP when forced into short mid-range floaters.',
    correct: 'drop',
    explanation:
      'By dropping the big man into the paint, you take away the lob threat (rim). The on-ball defender fights over the screen to take away the pull-up 3. You force the guard into the in-between area (short mid-range), yielding the lowest expected value (0.85 PPP).',
  },
  {
    id: '2',
    title: 'The Stretch 5 Problem',
    difficulty: 2,
    description: 'A dangerous shooting big man sets a screen for a quick guard.',
    players: [
      { id: 3, name: 'Quick Guard', x: 300, y: 100, isBallHandler: true,
        strengths: ['Speed'], weaknesses: ['30th percentile finishing against size'] },
      { id: 4, name: 'Stretch 5', x: 300, y: 150, isBallHandler: false,
        strengths: ['90th percentile 3pt frequency and efficiency'], weaknesses: ['Slow foot speed defensively'] },
    ],
    options: ['drop', 'switchAll', 'blitz'],
    analyticsContext:
      'The screening big is in the 90th percentile for 3pt efficiency. The guard struggles to finish at the rim against size (30th percentile).',
    correct: 'switchAll',
    explanation:
      'Dropping would leave the big man wide open for a pick-and-pop 3. Switching keeps a body on the 3-point shooter. You live with the mismatch of the guard driving on your big man, knowing the guard struggles to finish at the rim.',
  },
  {
    id: '3',
    title: 'Denying the Middle',
    difficulty: 4,
    description:
      'A side pick-and-roll is occurring near the wing. The ball handler is elite at making reads when they get to the middle of the floor.',
    players: [
      { id: 5, name: 'Wing Playmaker', x: 650, y: 300, isBallHandler: true,
        strengths: ['1.20 PPP when driving middle', 'Elite vision'], weaknesses: ['0.90 PPP when forced baseline'] },
      { id: 6, name: 'Screener', x: 600, y: 300, isBallHandler: false,
        strengths: ['Solid screen'], weaknesses: [] },
    ],
    options: ['hardHedge', 'drop', 'ice'],
    analyticsContext:
      "When forced toward the baseline, the offense's efficiency drops to 0.90 PPP due to reduced passing angles and the sideline acting as an extra defender.",
    correct: 'ice',
    explanation:
      'The on-ball defender jumps to the top side of the ball handler, denying the middle. The big man drops to contain the drive, effectively using the sideline to trap the handler and force the inefficient baseline drive.',
  },
  {
    id: '4',
    title: 'Spain Pick & Roll',
    difficulty: 5,
    description:
      "The offense runs a high Pick and Roll, but a third offensive player sets a back-screen on the roll man's defender. This creates immense pressure at the rim.",
    players: [
      { id: 7, name: 'Point Guard', x: 400, y: 150, isBallHandler: true,
        strengths: ['Elite playmaker'], weaknesses: [] },
      { id: 8, name: 'Roll Man', x: 400, y: 200, isBallHandler: false,
        strengths: ['Lob threat'], weaknesses: [] },
      { id: 9, name: 'Back Screener', x: 400, y: 300, isBallHandler: false,
        strengths: ['Elite 3pt shooter'], weaknesses: [] },
    ],
    options: ['drop', 'switchAll', 'blitz'],
    analyticsContext:
      'Spain PnR yields 1.25 PPP if the defense drops, due to the confusion between the lob and the pop. Switching the back-screen neutralizes the lob and keeps a body on the shooter, dropping PPP to 0.95.',
    correct: 'switchAll',
    explanation:
      'By switching the back-screen (the big guards the shooter, the wing guards the roll man), you take away the lob and the open 3. You concede a size mismatch in the post, which is statistically less efficient (0.95 PPP) than a lob or an open 3.',
  },
  {
    id: '5',
    title: 'The Curry Problem',
    difficulty: 4,
    description:
      'The ball handler is a generational shooter, capable of pulling up from 30 feet if given a sliver of space off the screen.',
    players: [
      { id: 10, name: 'Generational Shooter', x: 400, y: 120, isBallHandler: true,
        strengths: ['1.30 PPP on pull-up 3s'], weaknesses: ['Turnover prone under extreme pressure'] },
      { id: 11, name: 'Screener', x: 400, y: 160, isBallHandler: false,
        strengths: ['Good short-roller'], weaknesses: ['Average playmaker'] },
    ],
    options: ['drop', 'ice', 'blitz'],
    analyticsContext:
      'Dropping yields an open pull-up 3 (1.30 PPP). Blitzing forces the ball out of their hands, forcing the screener to make plays in a 4-on-3 scenario (1.05 PPP).',
    correct: 'blitz',
    explanation:
      'You must Blitz (trap) the ball handler to force the ball out of their hands. While you concede a 4-on-3 advantage to the offense, trusting your backend rotations against a non-elite playmaking screener is statistically better than giving up an open 3.',
  },
  {
    id: '6',
    title: 'The Ghost Screen',
    difficulty: 3,
    description:
      "A shooter runs toward the ball handler as if to set a screen, but sprints out to the 3-point line at the last second (a 'ghost' screen).",
    players: [
      { id: 12, name: 'Slasher', x: 250, y: 150, isBallHandler: true,
        strengths: ['Elite rim pressure'], weaknesses: ['Poor jump shooter'] },
      { id: 13, name: 'Movement Shooter', x: 300, y: 180, isBallHandler: false,
        strengths: ['Elite catch-and-shoot 3s'], weaknesses: [] },
    ],
    options: ['switchAll', 'hardHedge', 'drop'],
    analyticsContext:
      'Trying to fight over or hedge a screen that never happens leads to two defenders guarding the ball, leaving the shooter wide open (1.40 PPP).',
    correct: 'switchAll',
    explanation:
      'Switch All is the safest coverage against ghost screens. Because no actual physical contact is made on the screen, switching seamlessly prevents the defense from getting tangled, ensuring a defender stays attached to the movement shooter.',
  },
  {
    id: '7',
    title: 'The Zoom Action',
    difficulty: 4,
    description:
      "The offense runs 'Zoom' action: a pindown screen flowing immediately into a dribble hand-off (DHO) for a shooter.",
    players: [
      { id: 14, name: 'Shooting Guard', x: 200, y: 300, isBallHandler: false,
        strengths: ['Elite coming off screens'], weaknesses: ['Average ball handler'] },
      { id: 15, name: 'Big (DHO)', x: 250, y: 150, isBallHandler: true,
        strengths: ['Elite screen setter'], weaknesses: ['Non-shooter'] },
      { id: 16, name: 'Pindown Screener', x: 200, y: 250, isBallHandler: false,
        strengths: ['Good screener'], weaknesses: [] },
    ],
    options: ['drop', 'switchAll', 'ice'],
    analyticsContext:
      'Chasing the shooter over both screens usually results in trailing the play, giving up 1.15 PPP. Switching the DHO neutralizes the advantage (0.90 PPP).',
    correct: 'switchAll',
    explanation:
      "Switch All (specifically 'switching out' on the DHO) is the best way to blow up Zoom action. By switching the big onto the shooter and the guard onto the DHO big, you keep a defender between the shooter and the basket at all times.",
  },
  {
    id: '8',
    title: 'Empty Corner Pick & Roll',
    difficulty: 3,
    description:
      'The offense clears out an entire side of the floor to run a Pick and Roll, leaving no help defenders on the strong side.',
    players: [
      { id: 17, name: 'Athletic Guard', x: 600, y: 150, isBallHandler: true,
        strengths: ['Elite downhill driver'], weaknesses: ['Average playmaker'] },
      { id: 18, name: 'Rim Runner', x: 550, y: 180, isBallHandler: false,
        strengths: ['Lob threat'], weaknesses: ['Cannot shoot'] },
    ],
    options: ['blitz', 'drop', 'ice'],
    analyticsContext:
      'Because the corner is empty, a baseline drive has no passing outlets. Forcing the ball handler baseline drops their PPP to 0.85.',
    correct: 'ice',
    explanation:
      'ICE (or Down) is perfect for an empty corner. You force the ball handler toward the baseline where they have no shooting angles and no corner teammate to pass to, effectively using the baseline as an extra defender.',
  },
  {
    id: '9',
    title: 'The Short Roll Playmaker',
    difficulty: 5,
    description:
      'You trap the star guard, forcing the ball to the rolling big man. However, the big man is an elite passer in 4-on-3 situations (e.g., Draymond Green).',
    players: [
      { id: 19, name: 'Star Guard', x: 400, y: 120, isBallHandler: true,
        strengths: ['Generational scorer'], weaknesses: [] },
      { id: 20, name: 'Playmaking Big', x: 400, y: 200, isBallHandler: false,
        strengths: ['Elite court vision', 'High IQ'], weaknesses: ['Reluctant scorer'] },
    ],
    options: ['blitz', 'drop', 'switchAll'],
    analyticsContext:
      'Blitzing and giving the ball to an elite short-roll playmaker in space yields 1.25 PPP. Dropping keeps the play 2-on-2 but concedes a pull-up 3.',
    correct: 'switchAll',
    explanation:
      'Against an elite short-roll playmaker, you cannot Blitz. Switch All allows you to keep the ball handler contained without giving the playmaking big man a 4-on-3 advantage in the middle of the floor.',
  },
  {
    id: '10',
    title: 'Step-Up Screen in Transition',
    difficulty: 3,
    description:
      'Early in the shot clock, the big man sets a screen parallel to the baseline (a step-up screen) to get the guard downhill quickly.',
    players: [
      { id: 21, name: 'Speedy Guard', x: 700, y: 200, isBallHandler: true,
        strengths: ['Fastest player on court'], weaknesses: ['Struggles in half-court sets'] },
      { id: 22, name: 'Trailing Big', x: 700, y: 250, isBallHandler: false,
        strengths: ['Sets hard screens'], weaknesses: ['Poor stamina'] },
    ],
    options: ['ice', 'hardHedge', 'drop'],
    analyticsContext:
      'If the guard gets middle penetration in transition, it breaks the defense (1.20 PPP). Denying the middle forces them to slow down and set up the offense (0.95 PPP).',
    correct: 'ice',
    explanation:
      'ICE is the best way to handle a step-up screen. By jumping to the high side and forcing the guard toward the sideline, you deny them the middle of the floor and buy time for the rest of your defense to get back in transition.',
  },
];
