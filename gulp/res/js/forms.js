/* globals __ __n modal Tegaki grecaptcha hcaptcha captchaController appendLocalStorageArray socket isThread setLocalStorage forceUpdate captchaController uploaditem isCanvasBlocked TegakiWrapper sha256Bytes */
async function videoThumbnail(file) {
	return new Promise((resolve, reject) => {
		const hiddenVideo = document.createElement('video');
		hiddenVideo.setAttribute('src', URL.createObjectURL(file));
		hiddenVideo.load();
		hiddenVideo.addEventListener('error', err => {
			reject(err);
		});
		hiddenVideo.addEventListener('loadedmetadata', () => {
			//apparently 'loadedmetadata' is too early -.-
			setTimeout(() => {
				hiddenVideo.currentTime = 0;
			}, 500);
			hiddenVideo.addEventListener('seeked', () => {
				const canvas = document.createElement('canvas');
				canvas.width = hiddenVideo.videoWidth;
				canvas.height = hiddenVideo.videoHeight;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(hiddenVideo, 0, 0, canvas.width, canvas.height);
				ctx.canvas.toBlob(blob => {
					resolve(blob);
				});
			});
		});
	});
}

function doModal(data, postcallback, loadcallback) {
	try {
		const modalHtml = modal({ modal: data });
		let checkInterval;
		document.body.insertAdjacentHTML('afterbegin', modalHtml);
		const modals = document.getElementsByClassName('modal');
		const modalBgs = document.getElementsByClassName('modal-bg');
		window.dispatchEvent(new CustomEvent('showModal', {
			detail: {
				modal: modals[0],
			}
		}));
		if (modals.length > 1) {
			const latestModalIndex = parseInt(document.defaultView.getComputedStyle(modals[1], null).getPropertyValue('z-index'));
			//from appeals, or holding enter. make sure they show up above the previous modal
			modals[0].style.zIndex = latestModalIndex + 3;
			modalBgs[0].style.zIndex = latestModalIndex + 2;
		}
		if (loadcallback != null) {
			loadcallback();
		}
		document.getElementById('modalclose').onclick = () => {
			removeModal();
			clearInterval(checkInterval);
		};
		document.getElementsByClassName('modal-bg')[0].onclick = () => {
			removeModal();
			clearInterval(checkInterval);
		};
		const modalframe = document.getElementById('modalframe');
		if (modalframe) {
			if (localStorage.getItem('theme') === 'default') {
				modalframe.onload = () => {
					//if theres a modal frame and user has default theme, style it
					const currentTheme = document.head.querySelector('#theme').href;
					modalframe.contentDocument.styleSheets[1].ownerNode.href = currentTheme;
				};
			}
			if (postcallback) {
				checkInterval = setInterval(() => {
					if (modalframe && modalframe.contentDocument.title == __('Success')) {
						clearInterval(checkInterval);
						removeModal();
						postcallback();
					}
				}, 100);
			}
		}
	} catch (e) {
		console.error(e);
	}
}

const modalClasses = ['modal', 'modal-bg'];
function removeModal() {
	modalClasses.forEach(c => document.getElementsByClassName(c)[0].remove());
}

let recaptchaResponse = null;
function recaptchaCallback (response) { // eslint-disable-line
	recaptchaResponse = response;
}

let tegakiWidth = localStorage.getItem('tegakiwidth-setting');
let tegakiHeight = localStorage.getItem('tegakiheight-setting');

class postFormHandler {

	constructor(form) {
		this.form = form;
		this.resetOnSubmit = this.form.dataset.resetOnSubmit == 'true';
		this.enctype = this.form.getAttribute('enctype');
		this.messageBox = this.form.querySelector('#message');
		this.recordTegaki = this.form.elements.tegakireplay;
		this.canvasBlocked = null;
		this.canvasCheckInterval = null;
		this.minimal = this.form.elements.minimal;
		this.files = [];
		this.submit = form.querySelector('input[type="submit"]');
		if (this.submit) {
			this.originalSubmitText = this.submit.value;
		}

		//get different element for diffeent captcha types
		this.captchaField = form.querySelector('.captchafield')
			|| form.querySelector('.g-recaptcha')
			|| form.querySelector('.h-captcha');

		//if tegaki button, attach the listener to open tegaki
		this.tegakiButton = form.querySelector('.tegaki-button');
		if (this.tegakiButton) {
			this.tegakiButton.addEventListener('click', () => this.doTegaki());
		}

		//if web3 login button, do login procedure on click
		this.web3LoginButton = form.querySelector('.web3-login');
		if (this.web3LoginButton) {
			this.web3LoginButton.addEventListener('click', (e) => this.doWeb3Login(e));
		}

		//deposit share the page's post form; a hidden 'nonce' input also exists
		//on deposit-report action forms, so key off the post-form flag rather
		//than the mere presence of a nonce field.
		this.postFormForDeposit = document.querySelector('form[data-deposit-report="true"]');
		this.depositField = form.querySelector('input[name="nonce"]');
		this.depositRequired = window.depositGate.requiresPostSign(this.postFormForDeposit === form, this.depositField != null);

		//public post actions (report, delete, spoiler, unlink) are signed with the
		//deposit wallet. The action form carries the nonce field with the site/board
		//for the message; staff action forms have none and are not signed.
		this.actionNonceField = form.querySelector('input[name="nonce"][data-site]');

		//account registration signs a username-bound message with a deposit wallet
		this.depositRegister = form.dataset.depositSign === 'register';

		//if file input, attach listeners for adding files, drag+drop, etc
		this.fileInput = form.querySelector('input[type="file"]');
		if (this.fileInput) {
			this.fileRequired = this.fileInput.required;
			this.fileLabel = this.fileInput.previousSibling;
			this.fileUploadList = this.fileInput.nextSibling;
			this.multipleFiles = this.fileLabel.parentNode.previousSibling.firstChild.textContent.endsWith('s');
			this.fileLabelText = this.fileLabel.childNodes[0];
			this.fileLabel.addEventListener('dragover', e => this.fileLabelDrag(e));
			this.fileLabel.addEventListener('drop', e => this.fileLabelDrop(e));
			this.fileInput.addEventListener('change', e => this.fileInputChange(e));
			this.fileLabel.addEventListener('auxclick', e => this.fileLabelAuxclick(e));
			form.addEventListener('paste', e => this.paste(e));
		}

		//if custom flag select, attach listener and set from local storage if saved
		this.customFlagInput = this.form.elements.customflag;
		this.selectedFlagImage = document.getElementById('selected-flag');
		if (this.customFlagInput && this.selectedFlagImage) {
			this.customFlagInput.addEventListener('change', () => this.updateFlagField(), false);
			this.updateFlagField();
		}

		//allow control+enter to submit when in message input
		if (this.messageBox) {
			this.messageBox.addEventListener('keydown', e => this.controlEnterSubmit(e));
		}

		form.addEventListener('submit', e => this.formSubmit(e));
	}

	reset() {
		this.form.reset();
		this.updateFlagField();
		this.updateMessageBox();
		this.files = [];
		this.updateFilesText();
		const captcha = this.form.querySelector('.captcharefresh');
		if (captcha) {
			captcha.dispatchEvent(new Event('click'));
		}
	}

	doTegaki() {
		clearInterval(this.canvasCheckInterval);
		if ((this.canvasBlocked = isCanvasBlocked())
			&& localStorage.getItem('checkedCanvas') === 'true') {
			return doModal({
				'title': 'Canvas Permission Error',
				'message': 'Your browser has canvas disabled or broken due to anti-fingerprinting measures.',
			});
		}
		if (localStorage.getItem('checkedCanvas') !== 'true' && this.canvasBlocked) {
			if (!this.canvasCheckInterval || this.canvasCheckInterval._destroyed == true) {
				this.canvasCheckInterval = setInterval(() => {
					if (!isCanvasBlocked()) {
						this.doTegaki();
					}
				}, 250);
			}
			return localStorage.setItem('checkedCanvas', 'true');
		}
		const saveReplay = this.recordTegaki && this.recordTegaki.checked;
		TegakiWrapper.init();
		Tegaki.open({
			target: TegakiWrapper.element,
			saveReplay,
			onCancel: () => {
				TegakiWrapper.remove();
			},
			onDone: () => {
				const now = Date.now();
				let replayBlob;
				if (saveReplay) {
					replayBlob = Tegaki.replayRecorder.toBlob();
				}
				//add tegaki image
				Tegaki.flatten().toBlob(imageBlob => {
					this.addFile(new File([imageBlob], `${now}-tegaki.png`, { type: 'image/png' }), { stripFilenames: false });
					//add replay file
					replayBlob && this.addFile(new File([replayBlob], `${now}-tegaki.tgkr`, { type: 'tegaki/replay' }), { stripFilenames: false });
				}, 'image/png');
				//update file list
				this.updateFilesText();
				//reset tegaki state
				Tegaki.resetLayers();
				TegakiWrapper.remove();
			},
			width: tegakiWidth,
			height: tegakiHeight,
		});
		Tegaki.resetLayers();
		Tegaki.setColorPalette(2); //picks a better default color palette
	}

	async doWeb3Login(e) {
		e.target.style.pointerEvents = 'none'; //way of disabling dummy button to prevent double click
		try {
			const accounts = await window.jschanweb3.eth.requestAccounts();
			const nonceResponse = await fetch(`/nonce/${encodeURIComponent(accounts[0])}.json`)
				.then(res => res.json());
			const nonce = nonceResponse && nonceResponse.nonce;
			if (!nonce) { throw Error('Nonce request failed'); }
			const signingMesssage = `Nonce: ${nonce}`;
			const signature = await window.jschanweb3.currentProvider.request({
				method: 'personal_sign',
				params: [signingMesssage, accounts[0]],
			});
			this.form.elements.signature.value = signature;
			this.form.elements.address.value = accounts[0];
			this.form.elements.nonce.value = nonce;
			this.form.requestSubmit();
		} catch (e) {
			console.warn(e);
		} finally {
			e.target.style.pointerEvents = 'auto';
		}
	}

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
	}

	//the public actions ticked on this action form, and the ticked posts
	selectedActions() {
		return window.depositGate.publicActions.filter(name => {
			const box = this.form.elements[name];
			return box && box.checked;
		});
	}

	selectedPosts() {
		return Array.from(this.form.elements)
			.filter(el => el.name === 'checkedposts' && el.checked)
			.map(el => el.value);
	}

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
	}

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
	}

	//show why signing failed: a wallet rejection, or the error that stopped it
	depositSignError(err) {
		const cancelled = err && err.code === 4001;
		doModal({
			'title': __('Deposit'),
			'message': cancelled ? __('Signing was cancelled in your wallet.') : __('Failed to sign with your wallet.'),
			...(!cancelled && err && err.message ? { 'error': err.message } : {}),
		});
	}

	sha256Hex(input) {
		return sha256Bytes(new TextEncoder().encode(input));
	}

	sha256HexBytes(buffer) {
		return sha256Bytes(buffer);
	}

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
	}

	updateFlagField() {
		if (this.customFlagInput && this.customFlagInput.options.selectedIndex !== -1) {
			this.selectedFlagImage.src = this.customFlagInput.options[this.customFlagInput.options.selectedIndex].dataset.src || '';
		}
	}

	controlEnterSubmit(e) {
		if (e.ctrlKey && e.key === 'Enter') {
			this.formSubmit(e);
		}
	}

	formSubmit(e) {

		//deposit boards: ask the wallet to sign first, then submit with hidden fields
		//each signature consumes a single-use nonce, so clear the flag once used
		if (this.depositRequired) {
			if (!this.depositSigned) {
				e.preventDefault();
				return this.doDepositSign(e);
			}
			this.depositSigned = false;
		}

		//post actions: sign when a public action is selected for this submission
		if (window.depositGate.requiresActionSign(this.actionNonceField != null, this.selectedActions())) {
			if (!this.depositActionSigned) {
				e.preventDefault();
				return this.doDepositActionSign(e);
			}
			this.depositActionSigned = false;
		}

		if (this.depositRegister) {
			if (!this.depositRegisterSigned) {
				e.preventDefault();
				return this.doDepositRegisterSign(e);
			}
			this.depositRegisterSigned = false;
		}

		//get the captcha response if any recaptcha
		const captchaResponse = recaptchaResponse;

		//build the form data based on form enctype
		let postData;
		if (this.enctype === 'multipart/form-data') {
			this.fileInput && (this.fileInput.disabled = true);
			postData = new FormData(this.form);
			if (captchaResponse) {
				postData.append('captcha', captchaResponse);
			}
			this.fileInput && (this.fileInput.disabled = false);
			if (this.files && this.files.length > 0) {
				/* add each file to data individually, since we handle multiple files in multiple sessions of
					selecting, not just the last time (see addFile()) */
				for (let i = 0; i < this.files.length; i++) {
					postData.append('file', this.files[i]);
				}
			}
		} else {
			postData = new URLSearchParams([...(new FormData(this.form))]);
			if (captchaResponse) {
				postData.set('captcha', captchaResponse);
			}
		}

		/* if it is a "minimal" form (used in framed bypases) or ticked the "edit" box in post actions,
			dont preventDefault because we just want to use non-js form submission */
		if (this.minimal
			|| (postData instanceof URLSearchParams && postData.get('edit') === '1')) {
			return true;
		} else {
			e.preventDefault();
		}

		//prepare new request
		const xhr = new XMLHttpRequest();

		if (this.submit) {
			//disable submit button to prevent submitting while one in progress
			this.submit.disabled = true;
			//update the text on the submit button, and show upload progress if form has files
			this.submit.value = 'Processing...';
			if (this.files && this.files.length > 0) {
				xhr.onloadstart = () => {
					this.submit.value = '0%';
				};
				xhr.upload.onprogress = (ev) => {
					const progress = Math.floor((ev.loaded / ev.total) * 100);
					this.submit.value = `${progress}%`;
				};
				xhr.onload = () => {
					this.submit.value = this.originalSubmitText;
				};
			}
		}

		xhr.onreadystatechange = () => {

			//request finished
			if (xhr.readyState === 4) {

				//if the google/hcaptcha/yandex was filled, reset it now
				if (captchaResponse && grecaptcha) {
					grecaptcha.reset();
				} else if (captchaResponse && hcaptcha) {
					hcaptcha.reset();
				} else if (captchaResponse && window.smartCaptcha) {
					window.smartCaptcha.reset();
				}

				//remove captcha if server says it is no longer enabled	(submitting one when not needed doesnt cause any problem)
				if (xhr.getResponseHeader('x-captcha-enabled') === 'false') {
					captchaController.removeCaptcha();
					this.captchaField = null;
				}

				//re-enable the submit button now, and set the submit button text back to original value
				if (this.submit) {
					this.submit.disabled = false;
					this.submit.value = this.originalSubmitText;
				}

				//try and parse json from the response if there is a body
				let json;
				if (xhr.responseText) {
					try {
						json = JSON.parse(xhr.responseText);
					} catch (e) {
						//wasnt json response
					}
				}

				if (json) {
					if (xhr.status == 200) {

						//response had a postId from successful post so set here for scrolling to new posts
						if (json.postId) {
							window.myPostId = json.postId;
						}

						//deposit boards: show any pending warnings to the poster
						if (json.warnings && json.warnings.length > 0) {
							const warnList = json.warnings.map(w => (w.reason ? w.reason : __('Warning'))).join('\n');
							doModal({
								'title': __('Warnings'),
								'message': warnList,
							});
						}

						//get board and postId to add to (you)s
						if (json.redirect) {
							const redirectBoard = json.redirect.split('/')[1];
							const redirectPostId = json.redirect.split('#')[1];
							if (redirectBoard && redirectPostId) {
								appendLocalStorageArray('yous', `${redirectBoard}-${redirectPostId}`);
							}
						}

						//do modal for errors/messages
						if (json.message || json.messages || json.error || json.errors) {
							doModal(json);
						} else if (socket && socket.connected) {
							//set hash to scroll to your post if you are connected to the socket (it will be in the DOM by this point)
							window.location.hash = json.postId;
						} else {
							//if we are not in a thread so follow the redirect to open the new thread
							if (!isThread) {
								return window.location = json.redirect;
							}
							//otherwise save the postId for you tracking after forceUpdate() finishes
							setLocalStorage('myPostId', json.postId);
							//not connected to socket, so force fetch the JSON
							forceUpdate();
						}

						//if the form has data attribute to reset on submission, clear it now (reset() handled stuff like saved name, flag, etc)
						if (this.resetOnSubmit) {
							this.reset();
						}

					} else {

						//not a 200 so probably error
						if (!this.captchaField && json.message === __('Incorrect captcha answer')) {
							/* add missing captcha field if we got an error about it and the form has no captcha field
								(must have been enabeld after we loaded the page) */
							captchaController.addMissingCaptcha();
							this.captchaField = true;
						} else if (json.message === __('Captcha expired')) {
							//if captcha is expired, just refresh the captcha
							const captcha = this.form.querySelector('.captcharefresh');
							if (captcha) {
								captcha.dispatchEvent(new Event('click'));
							}
						} else if (json.bans) {
							//if user is banned, display their bans table and appeal form in a special modal
							doModal(json, null, () => {
								const modalBanned = document.getElementById('modalbanned');
								const modalBanForm = modalBanned.querySelector('form');
								const modalAppealHandler = new postFormHandler(modalBanForm);
								for (let modalFormElement of modalBanForm.querySelectorAll('input[name="checkedbans"]')) {
									//for ease of appeal, pre-check all the bans in this case.
									modalFormElement.checked = true;
								}
								const appealCaptcha = modalAppealHandler.captchaField;
								if (appealCaptcha) {
									captchaController.setupCaptchaField(appealCaptcha);
								}
							});
						} else {
							/* otherwise just show modal with errors/messages, and callback will be optionally used
								for 403 if they have to do a bypass and submit the iframe */
							doModal(json, () => {
								this.formSubmit(e);
							});
						}

					}
				} else if (xhr.responseURL
					&& xhr.responseURL !== `${location.origin}${this.form.getAttribute('action')}`) {
					//not an json and a redirect not to current url (which would be edits), so redirect to new location.
					return window.location = xhr.responseURL;
				} else if (xhr.status === 413) {
					//413 but not a json, must be nginx so show generic error
					doModal({
						'title': 'Payload Too Large',
						'message': 'Your upload was too large',
					});
				} else {
					//something is completely wrong, usually no connection or server down
					doModal({
						'title': 'Error',
						'message': 'Something broke'
					});
				}

				if (this.submit) {
					this.submit.value = this.originalSubmitText;
				}

			}
		};

		//gives a useless error, so once again show generic "something broke"
		xhr.onerror = (err) => {
			console.error(err);
			doModal({
				'title': 'Error',
				'message': 'Something broke'
			});
			if (this.submit) {
				this.submit.disabled = false;
				this.submit.value = this.originalSubmitText;
			}
		};

		//open the request
		xhr.open(this.form.getAttribute('method'), this.form.getAttribute('action'), true);

		//if not a minimal form, send special header so server knows to send json in dynamicResponse()
		if (!this.minimal) {
			xhr.setRequestHeader('x-using-xhr', true);
		}

		//if using live and connected, send special header so server knows to
		const isLive = localStorage.getItem('live') == 'true' && socket && socket.connected;
		if (isLive) {
			xhr.setRequestHeader('x-using-live', true);
		}

		//if not multipart form set correct header
		if (this.enctype !== 'multipart/form-data') {
			xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
		}

		//send the request
		xhr.send(postData);

	}

	//forcefully update message box of form for character counter used e.g. in reset() because input event would not be fired
	updateMessageBox() {
		this.messageBox && this.messageBox.dispatchEvent(new Event('input'));
	}

	removeFile(fileElem, name, size) {
		fileElem.remove();
		let fileIndex;
		this.files.find((f, index) => {
			if (f.name === name && f.size === size) {
				fileIndex = index;
			}
		});
		this.files.splice(fileIndex, 1);
		this.updateFilesText();
	}

	async addFile(file, fileOptions = {}) {
		if (this.fileRequired) { //prevent drag+drop issues by removing required
			this.fileInput.removeAttribute('required');
		}
		this.files.push(file);
		console.log('got file', file.name);
		let fileHash;
		if (window.crypto.subtle) {
			let fileBuffer;
			if (file.arryaBuffer) {
				fileBuffer = await file.arrayBuffer();
			} else {
				//can old browsers just fuck off please?
				const bufferFileReader = new FileReader();
				await new Promise(res => {
					bufferFileReader.addEventListener('loadend', res);
					bufferFileReader.readAsArrayBuffer(file);
				});
				if (bufferFileReader.result) {
					fileBuffer = bufferFileReader.result;
				}
			}
			const fileDigest = await window.crypto.subtle.digest('SHA-256', fileBuffer);
			fileHash = Array.from(new Uint8Array(fileDigest))
				.map(c => c.toString(16).padStart(2, '0'))
				.join('');
			console.log('file hash', fileHash);
		}
		const item = {
			spoilers: this.fileUploadList.dataset.spoilers === 'true',
			stripFilenames: this.fileUploadList.dataset.stripFilenames === 'true',
			name: file.name,
			hash: fileHash,
			...fileOptions,
		};

		switch (file.type.split('/')[0]) {
			case 'image':
				item.url = URL.createObjectURL(file);
				break;
			case 'audio':
				item.url = '/file/audio.png';
				break;
			case 'video':
				try {
					const thumbnailBlob = await videoThumbnail(file);
					item.url = URL.createObjectURL(thumbnailBlob);
				} catch (err) {
					//couldnt create video thumb for some reason
					item.url = '/file/video.png';
				}
				break;
			default:
				item.url = '/file/attachment.png';
				break;
		}
		const uploadItemHtml = uploaditem({ uploaditem: item });
		this.fileUploadList.insertAdjacentHTML('beforeend', uploadItemHtml);
		const fileElem = this.fileUploadList.lastChild;
		const lastClose = fileElem.querySelector('.close');
		lastClose.addEventListener('click', () => {
			this.removeFile(fileElem, file.name, file.size);
		});
		this.fileUploadList.style.display = 'unset';
	}

	//show number of files on new label
	updateFilesText() {
		if (!this.fileLabelText) {
			return;
		}
		if (this.files && this.files.length === 0) {
			this.fileUploadList.textContent = '';
			this.fileUploadList.style.display = 'none';
			this.fileLabelText.nodeValue = __n('Select/Drop/Paste files', this.multipleFiles ? 2 : 1);
		} else {
			this.fileLabelText.nodeValue = __n('%s files selected', this.files.length);
		}
		this.fileInput.value = null;
	}

	//remove all files from this form
	clearFiles() {
		if (!this.fileInput) {
			return;
		}
		this.files = []; //empty file list
		this.fileInput.value = null; //remove the files for real
		if (this.fileRequired) { //reset to required if clearing files
			this.fileInput.setAttribute('required', true);
		}
		this.updateFilesText();
	}

	//paste files from clipboard
	paste(e) {
		const clipboard = e.clipboardData;
		if (clipboard.items && clipboard.items.length > 0) {
			const items = clipboard.items;
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item.kind === 'file') {
					const file = new File([item.getAsFile()], 'ClipboardImage.png', { type: item.type });
					this.addFile(file);
				}
			}
			this.updateFilesText();
		}
	}

	//change cursor on hover when drag+dropping files
	fileLabelDrag(e) {
		e.stopPropagation();
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	//add file on drag+drop
	fileLabelDrop(e) {
		e.stopPropagation();
		e.preventDefault();
		const newFiles = e.dataTransfer.files;
		for (let i = 0; i < newFiles.length; i++) {
			this.addFile(newFiles[i]);
		}
		this.updateFilesText();
	}

	//add file by normal file form, but add instead of replacing files
	fileInputChange() {
		const newFiles = this.fileInput.files;
		for (let i = 0; i < newFiles.length; i++) {
			this.addFile(newFiles[i]);
		}
		this.updateFilesText();
	}

	//middle click to clear files
	fileLabelAuxclick(e) {
		if (e.button !== 1) { //middle click only
			return;
		}
		this.clearFiles();
	}

}

window.addEventListener('DOMContentLoaded', () => {

	const myPostId = localStorage.getItem('myPostId');
	if (myPostId) {
		window.location.hash = myPostId;
		localStorage.removeItem('myPostId');
	}

	window.addEventListener('addPost', (e) => {
		if (e.detail.hover) {
			return; //dont need to handle hovered posts for this
		}
		if (window.myPostId == e.detail.postId) {
			window.location.hash = e.detail.postId;
			e.detail.post.previousSibling.scrollIntoView();
		}
	});

});

window.addEventListener('settingsReady', () => {

	const forms = document.getElementsByTagName('form');

	for (let i = 0; i < forms.length; i++) {
		if (forms[i].method === 'post') {
			new postFormHandler(forms[i]);
		}
	}

	const tegakiWidthSetting = document.getElementById('tegakiwidth-setting');
	const changeTegakiWidthSetting = (e) => {
		tegakiWidth = parseInt(e.target.value);
		setLocalStorage('tegakiwidth-setting', tegakiWidth);
	};
	tegakiWidthSetting.value = tegakiWidth;
	tegakiWidthSetting.addEventListener('change', changeTegakiWidthSetting, false);

	const tegakiHeightSetting = document.getElementById('tegakiheight-setting');
	const changeTegakiHeightSetting = (e) => {
		tegakiHeight = parseInt(e.target.value);
		setLocalStorage('tegakiheight-setting', tegakiHeight);
	};
	tegakiHeightSetting.value = tegakiHeight;
	tegakiHeightSetting.addEventListener('change', changeTegakiHeightSetting, false);

});
