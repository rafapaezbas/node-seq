const utils = require('./utils');
const render = require('./render');
const lib = require('./lib');
const midi = require('./midi');
const io = require('./midi-io');
const cons = require('./constants');
const chords = require('./chords');
var randomGen = require('random-seed');
const easymidi = require('easymidi');

var controller = [];
var scenes = [];
var state =  {
	pressedButtons:[],
	currentStep:0,
	currentTrack:0,
	currentScene:0,
	lastPressedStep:0,
	lastChordPressed: 0,
	scenesChain:[],
	currentSceneInChain:-1,
	chainMode:false,
	clockTick : -1,
	clockResolution : 6, //Number of ticks per step
	resetClockTimeout : undefined,
	midiNotesQueue:[],
	chords: [],
	mode : 'seq',
	renderReset : true,
	showCursor : true,
	smallGridMode : 'length',
	workspace : 2, // 0 : big_grid, 1 : brig_grid + notes, 2: big_grid + notes + small_grid
};

io.clockInput.on('clock', () => {
	state.clockTick++;
	midi.resetClock(state);
	if(state.clockTick % 6 == 0){
		midi.nextStep(state,scenes);
		state.currentStep++;
		if(state.mode == 'seq' && state.showCursor) {
			render.lightCurrentStep(state,scenes);
		}
	}
	midi.sendMidi(state);
});

io.input.on('noteon', (message) => {
	var pressed = message.velocity > 0;
	var button = message.note;
	update(pressed, button);
});

io.input.on('cc', (message) => {
	var pressed = message.value > 0;
	var button = message.controller;
	update(pressed, button);
});

const update = (pressed, button) => {
	switch(state.mode){
	case 'seq':
		updateSeqMode(pressed, button);
		break;
	case 'chords':
		updateChordMode(pressed, button);
		break;
	default:
		break;
	}
};

const updateSeqMode = (pressed, button) => {
	if(pressed){
		state.pressedButtons.push(button);
		if(controller['seq'][button] != undefined){
			controller['seq'][button].map(f => f(state,scenes));
			render.render(scenes,state);
		}
	}else{
		state.pressedButtons = state.pressedButtons.filter(b => b != button);
	}
};

const updateChordMode = (pressed, button) => {
	if(pressed){
		pressedChord(button);
		render.render(scenes,state);
	}else{
		unpressedChord(button);
	}
};

const pressedChord = (button) => {
	state.pressedButtons.push(button);
	var chord = state.chords[button];
	if(chord != undefined){
		state.lastChordPressed = button;
		var finalChord =chord.inversion.filter((e,i) => chords.filterByMode(i,chord.mode));
		finalChord.map(n => io.output.send('noteon', {note:n, velocity:127, channel:state.currentTrack}));
	}
	if(controller['chords'][button] != undefined){
		controller['chords'][button].map(f => f(state,scenes));
	}
};

const unpressedChord = (button) => {
	var chord = state.chords[button];
	if(state.chords[button] != undefined){
		chord.inversion.map(n => io.output.send('noteoff', {note:n, velocity:127, channel:state.currentTrack}));
	}
	state.pressedButtons = state.pressedButtons.filter(b => b != button);
};

const setupState = () => {
	state.chords = chords.createChords();
};

const setupScenes = () => {
	scenes = utils.createArray(4,{}).map(s => setupSceneTracks());
	return scenes;
};

const setupSceneTracks = () => {
	var trackColors = [cons.COLOR_TRACK_1,cons.COLOR_TRACK_2,cons.COLOR_TRACK_3,cons.COLOR_TRACK_4,
					   cons.COLOR_TRACK_5,cons.COLOR_TRACK_6,cons.COLOR_TRACK_7,cons.COLOR_TRACK_8];
	var tracks =  utils.createArray(8,{}).map((t,i) => {
		const pattern = utils.createArray(16,{}).map(p => ({active:false, notes:[1,0,0,0,0,0,0,0,0,0,0,0,0], chords:[], length : 1, velocity: 100, triplet: false}));
		return {pattern:pattern, trackLength:16, midiRoot:60, color: trackColors[i], muted: false, tempoModifier: 1, channel: i};
	});
	return {tracks: tracks};
};

const setupController = () => {
	controller['seq'] = [];
	controller['chords'] = [];
	controller['seq'][cons.TEMPO_BUTTON] = [lib.changeTempo];
	controller['seq'][cons.SHIFT_BUTTON] = [lib.toogleCursor];
	controller['seq'][cons.SHIFT_2_BUTTON] = [lib.toogleCursor];
	controller['seq'][cons.SHIFT_3_BUTTON] = [lib.toogleCursor];
	controller['seq'][cons.RIGHT_ARROW_BUTTON] = [lib.shiftPatternRight, lib.randomPattern];
	controller['seq'][cons.LEFT_ARROW_BUTTON] = [lib.shiftPatternLeft, lib.randomPattern];
	controller['seq'][cons.UP_ARROW_BUTTON] = [lib.toogleSmallGridMode];
	controller['seq'][cons.DOWN_ARROW_BUTTON] = [lib.toogleSmallGridMode];
	controller['seq'][cons.MODE_BUTTON] = [lib.toogleMode];
	controller['seq'][cons.CHANGE_WORKSPACE_BUTTON] = [lib.changeWorkspace];
	cons.INNER_GRID.map(e => controller['seq'][e] = [lib.toogleNote]);
	cons.SMALL_GRID.map(e => controller['seq'][e] = [lib.changeLength, lib.changeVelocity]);
	cons.SCENE_BUTTONS.map(e => controller['seq'][e] = [lib.changeScene,lib.copyScene,lib.chainScenes]);
	cons.BIG_GRID.map(e => controller['seq'][e] = [lib.toogleStep,lib.showNotes,lib.changeTrackLength,lib.copyStep, lib.toogleTriplet]);
	cons.MUTE_BUTTONS.map(e => controller['seq'][e] = [lib.toogleMute,lib.changeTrack]);
	controller['chords'][cons.MODE_BUTTON] = [lib.toogleMode]
	cons.GRID.map(e => controller['chords'][e] = [lib.toogleChords]);
	controller['chords'][cons.CHANGE_CHORD_MODE_BUTTON] = [lib.changeChordMode];
};

setupState();
setupScenes();
setupController();
render.render(scenes,state);
