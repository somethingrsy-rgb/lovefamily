import webpush from 'web-push';
const k = webpush.generateVAPIDKeys();
console.log('아래 값을 환경변수(.env 또는 호스팅 설정)에 넣어 주세요. PRIVATE 키는 절대 공개/커밋하지 마세요.\n');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:본인메일@example.com');
