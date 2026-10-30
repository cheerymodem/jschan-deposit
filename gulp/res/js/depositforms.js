/* globals __ doModal postFormHandler sha256Bytes */
'use strict';

//Deposit wallet signing for the post, post actions and registration forms. Kept
//out of forms.js so upstream merges stay small: forms.js calls depositInit from
//its constructor, depositIntercept at the top of formSubmit and
//depositShowWarnings after a post. Bundled right after forms.js; the handlers are
//created once the page is ready, so these methods are in place by then.
Object.assign(postFormHandler.prototype, {

	depositInit(form) {
		//the post form is flagged data-deposit-report="true" (modview forms are
		//not); a hidden 'nonce' input also exists on action forms, so key off the
		//flag rather than the mere presence of a nonce field
		this.postFormForDeposit = document.querySelector('form[data-deposit-report="true"]');
		this.depositField = form.querySelector('input[name="nonce"]');
		this.depositRequired = window.depositGate.requiresPostSign(this.postFormForDeposit === form, this.depositField != null);

		//public post actions (report, delete, spoiler, unlink) are signed with the
		//deposit wallet. The action form carries the nonce field with the site/board
		//for the message; staff action forms have none and are not signed.
		this.actionNonceField = form.querySelector('input[name="nonce"][data-site]');

		//account registration signs a username-bound message with a deposit wallet
		this.depositRegister = form.dataset.depositSign === 'register';
	},

	//ask the wallet to sign before submitting. Returns true when it took over the
	//submit; the sign method resubmits with the hidden fields filled. Each
	//signature consumes a single-use nonce, so the flag is cleared once used.
	depositIntercept(e) {
		if (this.depositRequired) {
			if (!this.depositSigned) {
				e.preventDefault();
				this.doDepositSign(e);
				return true;
			}
			this.depositSigned = false;
		}
		//post actions: sign when a public action is selected for this submission
		if (window.depositGate.requiresActionSign(this.actionNonceField != null, this.selectedActions())) {
			if (!this.depositActionSigned) {
				e.preventDefault();
				this.doDepositActionSign(e);
				return true;
			}
			this.depositActionSigned = false;
		}
		if (this.depositRegister) {
			if (!this.depositRegisterSigned) {
				e.preventDefault();
				this.doDepositRegisterSign(e);
				return true;
			}
			this.depositRegisterSigned = false;
		}
		return false;
	},

	//show any pending warnings in a post response to the poster
	depositShowWarnings(json) {
		if (json.warnings && json.warnings.length > 0) {
			const warnList = json.warnings.map(w => (w.reason ? w.reason : __('Warning'))).join('\n');
			doModal({
				'title': __('Warnings'),
				'message': warnList,
			});
		}
	},

	//deposit-required boards: fetch a nonce, build the signed message, personal_sign,
	//fill the hidden fields, then submit the detached form
	async doDepositSign(e) {
		try {
			if (!window.ethereum || !window.ethereum.request) {
				return doModal({
					'title': __('Deposit'),
					'message': __('A web3 wallet is required to post on this board.'),
				});
			}
			const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
			const address = accounts[0].toLowerCase();
			const nonceResponse = await fetch(`/nonce/${encodeURIComponent(address)}.json`).then(r => r.json());
			const nonce = nonceResponse && nonceResponse.nonce;
			if (!nonce) {
				throw Error('Nonce request failed');
			}
			const messageContent = await this.buildDepositMessage(address, nonce);
			const signature = await window.ethereum.request({
				method: 'personal_sign',
				params: [messageContent, address],
			});
			this.form.elements.signature.value = signature;
			this.form.elements.address.value = address;
			this.form.elements.nonce.value = nonce;
			this.depositSigned = true;
			this.formSubmit(e);
		} catch (err) {
			console.warn(err);
			this.depositSignError(err);
		}
	},

	//the public actions ticked on this action form, and the ticked posts
	selectedActions() {
		return window.depositGate.publicActions.filter(name => {
			const box = this.form.elements[name];
			return box && box.checked;
		});
	},

	selectedPosts() {
		return Array.from(this.form.elements)
			.filter(el => el.name === 'checkedposts' && el.checked)
			.map(el => el.value);
	},

	//post actions: sign the actions message (site, board, actions, posts) with the
	//deposit wallet, fill the hidden fields on the action form, then submit
	async doDepositActionSign(e) {
		try {
			if (!window.ethereum || !window.ethereum.request) {
				return doModal({
					'title': __('Deposit'),
					'message': __('A web3 wallet is required for post actions.'),
				});
			}
			const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
			const address = accounts[0].toLowerCase();
			const nonceResponse = await fetch(`/nonce/${encodeURIComponent(address)}.json`).then(r => r.json());
			const nonce = nonceResponse && nonceResponse.nonce;
			if (!nonce) {
				throw Error('Nonce request failed');
			}
			//site/board come from the action form's own nonce input, since pages
			//such as threads at the reply limit have no post form
			const { site, board } = this.actionNonceField.dataset;
			const messageContent = window.depositGate.buildActionsMessage({
				site,
				board,
				actions: this.selectedActions(),
				posts: this.selectedPosts(),
				nonce,
			});
			const signature = await window.ethereum.request({
				method: 'personal_sign',
				params: [messageContent, address],
			});
			this.form.querySelector('input[name="signature"]').value = signature;
			this.form.querySelector('input[name="address"]').value = address;
			this.actionNonceField.value = nonce;
			this.depositActionSigned = true;
			this.formSubmit(e);
		} catch (err) {
			console.warn(err);
			this.depositSignError(err);
		}
	},

	//registration: sign a username-bound message with the deposit wallet, fill the
	//deposit_* fields (plain address/signature would switch the server to web3
	//registration), then submit
	async doDepositRegisterSign(e) {
		try {
			if (!window.ethereum || !window.ethereum.request) {
				return doModal({
					'title': __('Deposit'),
					'message': __('A web3 wallet is required to register.'),
				});
			}
			const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
			const address = accounts[0].toLowerCase();
			const nonceResponse = await fetch(`/nonce/${encodeURIComponent(address)}.json`).then(r => r.json());
			const nonce = nonceResponse && nonceResponse.nonce;
			if (!nonce) {
				throw Error('Nonce request failed');
			}
			const messageContent = [
				'jschan-deposit register',
				`Site: ${this.form.dataset.site}`,
				`Username: ${(this.form.elements.username.value || '').trim().toLowerCase()}`,
				`Nonce: ${nonce}`,
			].join('\n');
			const signature = await window.ethereum.request({
				method: 'personal_sign',
				params: [messageContent, address],
			});
			this.form.elements.deposit_signature.value = signature;
			this.form.elements.deposit_address.value = address;
			this.form.elements.deposit_nonce.value = nonce;
			this.depositRegisterSigned = true;
			this.formSubmit(e);
		} catch (err) {
			console.warn(err);
			this.depositSignError(err);
		}
	},

	//show why signing failed: a wallet rejection, or the error that stopped it
	depositSignError(err) {
		const cancelled = err && err.code === 4001;
		doModal({
			'title': __('Deposit'),
			'message': cancelled ? __('Signing was cancelled in your wallet.') : __('Failed to sign with your wallet.'),
			...(!cancelled && err && err.message ? { 'error': err.message } : {}),
		});
	},

	sha256Hex(input) {
		return sha256Bytes(new TextEncoder().encode(input));
	},

	sha256HexBytes(buffer) {
		return sha256Bytes(buffer);
	},

	async buildDepositMessage(address, nonce) {
		const normalisedMessage = (this.messageBox.value || '').replace(/\r\n/igm, '\n');
		const messageSha = normalisedMessage.length === 0 ? '' : await this.sha256Hex(normalisedMessage);
		let filesSha = 'none';
		if (this.files && this.files.length > 0) {
			const hashes = [];
			for (const file of this.files) {
				//hash the raw bytes, not file.text() (which decodes binary as utf-8)
				hashes.push(await this.sha256HexBytes(await file.arrayBuffer()));
			}
			filesSha = hashes.sort().join(',');
		}
		const board = this.form.dataset.board;
		const thread = this.form.elements.thread ? (this.form.elements.thread.value || 'new') : 'new';
		return [
			'jschan-deposit post',
			`Site: ${this.form.dataset.site}`,
			`Board: ${board}`,
			`Thread: ${thread}`,
			`Message-SHA256: ${messageSha}`,
			`Files-SHA256: ${filesSha}`,
			`Nonce: ${nonce}`,
		].join('\n');
	},

});
