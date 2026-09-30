'use strict';

//remove wallet signature/address from a post before it is sent to any public
//destination (public thread rooms, public HTML/JSON builds) or to staff rooms that
//do not have VIEW_RAW_IP (the -hashed rooms). The -raw staff rooms receive the
//full post so staff can see the key.
const omitAddress = (post) => {
	const stripped = { ...post };
	delete stripped.signature;
	delete stripped.address;
	return stripped;
};

module.exports = omitAddress;
