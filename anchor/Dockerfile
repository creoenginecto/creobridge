FROM projectserum/build:v0.27.0

COPY . .

RUN yarn
RUN anchor build
RUN solana-keygen new -o id.json --no-bip39-passphrase

CMD /bin/bash
