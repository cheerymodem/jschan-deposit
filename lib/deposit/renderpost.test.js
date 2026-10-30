'use strict';

//Render the shared post mixin and the board/thread pages to guard against regressions
//in the public post header (selection checkbox, timestamp, links) and tombstone
//handling. These rendered HTML bugs shipped because nothing exercised the pug
//templates, so keep a lightweight harness here with hand-rolled locals.
const pug = require('pug');
const path = require('path');

const templateDir = path.join(__dirname+'/../../views/pages/');

const __ = (s) => s;
const __n = (singular) => singular;

//minimal stand-in post that exercises both the normal and tombstoned branches
const makePost = (overrides = {}) => ({
	'_id': 'abc1234567890abcdef',
	board: 'test',
	thread: null,
	postId: 10,
	date: new Date('2026-10-12T00:00:00.000Z'),
	name: 'Anon',
	subject: '',
	email: '',
	flag: null,
	tripcode: null,
	capcode: null,
	userId: null,
	sticky: 0,
	bumplocked: false,
	locked: false,
	cyclic: false,
	message: 'hello world',
	files: [],
	backlinks: [],
	replies: [],
	replyposts: 0,
	replyfiles: 0,
	ip: { cloak: 'a.b.c.IP4', raw: null, type: 0 },
	signature: null,
	address: null,
	hidden: false,
	...overrides,
});

const layoutLocals = {
	__,
	__n,
	pageLanguage: 'en-GB',
	viewRawIp: false,
	upLevel: '',
	csrf: 'csrf',
	permissions: null,
	captchaOptions: { type: 'text' },
	commit: 'test',
	globalLanguage: 'en-GB',
	locale: 'en-GB',
	defaultTheme: 'yotsuba-b',
	defaultCodeTheme: 'ir-black',
	board: { _id: 'test', settings: { captchaMode: 0, userPostDelete: true, theme: 'yotsuba-b', codeTheme: 'ir-black', language: 'en-GB', description: '', tags: [], announcement: { markdown: null, raw: null } } },
	deposit: { enabled: true },
	modview: false,
	manage: false,
	globalmanage: false,
	boardFlags: [],
	thread: null,
	isThread: false,
	globalAnnouncement: { markdown: null },
	announcements: [],
	globalLimit: null,
	ethereumLinksURL: 'https://etherscan.io/address/%s',
	reverseImageLinksURL: 'https://example.com/?url=%s',
	meta: { url: 'http://localhost:7000' },
};

const renderBoard = (posts) => {
	const options = {
		...layoutLocals,
		page: 1,
		threads: posts,
		csrf: 'csrf',
		globalLimits: { fieldLength: { name: '100', subject: '100', message: '2000', email: '100', postpassword: '100' } },
	};
	return pug.renderFile(`${templateDir}board.pug`, options);
};

//render the global manage reports page footer directly (has no board)
const renderGlobalFooter = (hasDepositReports) => {
	return pug.renderFile(`${templateDir}../includes/actionfooter_globalmanage.pug`, {
		...layoutLocals,
		hasDepositReports,
		deposit: { enabled: true },
	});
};

describe('post mixin / board rendering', () => {

	test('a normal post renders the selection checkbox and timestamp', () => {
		const html = renderBoard([makePost()]);
		expect(html).toMatch(/class="post-check" type="checkbox" name="checkedposts" value="10"/);
		expect(html).toContain('class="post-date');
		expect(html).toContain('hello world');
		expect(html).toMatch(/No\./);
	});

	test('a tombstoned post renders removed text and still has a checkbox', () => {
		const tombstoned = makePost({ tombstone: { reason: 'author', date: new Date(), modlog: null } });
		const html = renderBoard([tombstoned]);
		expect(html).toContain('Post removed by author');
		expect(html).toMatch(/class="post-check" type="checkbox" name="checkedposts" value="10"/);
		expect(html).not.toContain('hello world');
	});

	test('a confiscated tombstone links the modlog', () => {
		const tombstoned = makePost({ tombstone: { reason: 'confiscated', date: new Date(), modlog: { board: 'test', date: '10-12-2026' } } });
		const html = renderBoard([tombstoned]);
		expect(html).toContain('Post removed: deposit confiscated');
		expect(html).toMatch(/href="\/test\/logs\/10-12-2026\.html"/);
	});

	test('a hidden (withdrawing) post shows the exiting banner and no content', () => {
		const hidden = makePost({ hidden: true, tombstone: { reason: 'exiting', date: new Date(), modlog: null } });
		const html = renderBoard([hidden]);
		expect(html.toLowerCase()).toContain('deposit is exiting');
		expect(html).not.toContain('hello world');
	});

	test('address and signature never appear in the public board output', () => {
		//even though the raw post carries them, public render must not leak them
		const post = makePost({ address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', signature: '0xbeef' });
		const html = renderBoard([post]);
		expect(html).not.toContain('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
		expect(html).not.toContain('0xbeef');
	});

	test('a normal post keeps its post-data wrapper, edit marker and backlinks', () => {
		const post = makePost({
			edited: { date: new Date('2026-10-12T01:00:00.000Z'), username: 'mod' },
			backlinks: [{ postId: 11 }],
		});
		const html = renderBoard([post]);
		expect(html).toMatch(/<div class="post-data">[\s\S]*hello world/);
		expect(html).toContain('class="cb mv-5 ml-5 edited"');
		expect(html).toMatch(/class="replies mt-5 ml-5"[\s\S]*&gt;&gt;11/);
	});

	test('every board renders the deposit signing fields and no captcha', () => {
		//a captchaMode left over from upstream settings must not bring the captcha back
		const html = pug.renderFile(`${templateDir}board.pug`, {
			...layoutLocals,
			board: { ...layoutLocals.board, settings: { ...layoutLocals.board.settings, captchaMode: 2 } },
			page: 1,
			threads: [makePost()],
			globalLimits: { fieldLength: { name: '100', subject: '100', message: '2000', email: '100', postpassword: '100' } },
		});
		expect(html).toContain('data-deposit-report="true"');
		expect(html).toMatch(/name="nonce"/);
		expect(html.toLowerCase()).not.toContain('captcha');
	});

	test('staff views put a hidden confiscate button on signed posts; public views do not', () => {
		const address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
		const post = makePost({ address, signature: '0xbeef' });
		const mixin = 'include ../mixins/post.pug\n+post(post)';
		const staff = pug.render(mixin, { ...layoutLocals, post, modview: true, filename: `${templateDir}x.pug` });
		expect(staff).toMatch(new RegExp(`<button class="confiscate-button dummy-link ml-5" type="button" data-address="${address}" hidden`));
		expect(renderBoard([post])).not.toContain('confiscate-button');
	});

	test('head marks confiscation allowed only for global ban staff who can see addresses', () => {
		const { Permissions } = require('../permission/permissions.js');
		const head = (perms) => pug.render('include ../includes/head.pug', {
			...layoutLocals,
			filename: `${templateDir}x.pug`,
			Permissions,
			deposit: { enabled: true, chainId: 31337, contractAddress: '0xdc64' },
			permissions: { get: (p) => perms.includes(p) },
		});
		const both = head([Permissions.MANAGE_GLOBAL_BANS, Permissions.VIEW_RAW_IP]);
		expect(both).toContain('&quot;canConfiscate&quot;:true');
		expect(head([Permissions.MANAGE_GLOBAL_BANS])).toContain('&quot;canConfiscate&quot;:false');
		expect(head([Permissions.VIEW_RAW_IP])).toContain('&quot;canConfiscate&quot;:false');
	});

	test('upstream web3 post signing cannot be enabled per board (regression)', () => {
		//its extra "signature" input clashes with the deposit signature
		//(form.elements.signature becomes a RadioNodeList). The upstream code stays,
		//but no settings page offers the board option, so a saved board always gets
		//false, and the board default is false.
		const fs = require('fs');
		const read = (f) => fs.readFileSync(path.join(__dirname, '../../', f), 'utf8');
		expect(read('views/pages/managesettings.pug')).not.toContain('name=\'enable_web3\'');
		expect(read('views/includes/globalmanagesettings.pug')).not.toContain('board_defaults_enable_web3');
		expect(read('configs/template.js.example')).toMatch(/enableTegaki: true,[\s\S]*?enableWeb3: false,/);
		const html = renderBoard([makePost()]);
		expect(html).not.toContain('web3-sign');
	});

	test('global manage footer has no off-chain confiscation options', () => {
		//on-chain confiscation happens from the Deposits page (owner-signed tx),
		//not the reports action menu, so the footer must not render these
		const html = renderGlobalFooter(true);
		expect(html).not.toContain('Confiscate Reporter Deposits');
		expect(html).not.toContain('Confiscate Poster Deposits');
	});

});