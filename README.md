# Poolchain Devnet escrow

Bu depo şu an iki parçadan oluşuyor:

- `index.html`: Poolchain tasarım prototipi. Havuz ve başvuru verilerini tarayıcıda saklar; cüzdanla zincir işlemi göndermez. Uygulama arayüzü henüz aşağıdaki programı çağırmıyor.
- `programs/poolchain_escrow`: Solana/Anchor escrow programı kaynak kodu. SOL ve klasik SPL token havuzlarını destekler.

**Önemli:** Escrow programı bu ortamda derlenmedi veya Devnet'e dağıtılmadı. Program ID henüz gerçek bir dağıtım adresi değil. Bu sebeple mevcut web arayüzünden fon yatırmayın; ekrandaki demo işlemleri zincir üstünde değildir.

## Kurallar

- Havuz başına 1–8 katılımcı seçilebilir.
- Oluşturma sırasında toplam miktar escrow hesabına alınır. Miktar katılımcı sayısına kalansız bölünmelidir.
- Başvuran, cüzdanını imzalayıp en fazla 240 baytlık mesajını zincire yazar. Mesaj herkese açıktır; kişisel/hassas bilgi eklemeyin.
- Havuz sahibi başvuranları seçer. Bütün kontenjanlar seçildikten sonra yalnızca havuz sahibi dağıtımı başlatabilir.
- Dağıtım seçilen her başvuruyu doğrular ve her katılımcıya eşit payı aynı işlemde yollar. Solana işlemi başarısız olursa işlem atomik olarak geri alınır.
- Token desteği legacy SPL Token Program altındaki tokenlar içindir. Bilinmeyen mint adresleri resmi USDC/USDT olarak doğrulanmaz.
- Kanıt dosyaları bu programda zincire yüklenmez. Mevcut prototipin dosyaları yalnızca yükleyen kişinin tarayıcısında saklanır; diğer kullanıcılara aktarılmaz.

## Devnet'e hazırlama (WSL/Linux/macOS)

1. Solana CLI, Rust ve Anchor CLI 0.31.1 kurun. Windows kullanıyorsanız Anchor'ın resmi kurulum yönergeleri WSL kullanır: <https://www.anchor-lang.com/docs/installation>.
2. `solana config set --url devnet` çalıştırın; test cüzdanı oluşturun ve Devnet SOL alın. Ana ağ cüzdanınızı bu test için kullanmayın.
3. Depo kökünde `anchor keys sync` çalıştırın. Bu komut `declare_id!` ve `Anchor.toml` program adreslerini yeni program anahtar çiftine göre senkronlar. Program anahtar dosyasını gizli tutun ve asla Git'e eklemeyin.
4. `anchor build` ile programı derleyin. Derleme hataları çözülmeden dağıtmayın.
5. `anchor deploy --provider.cluster devnet` ile dağıtın. Cüzdan bu işlemi imzalamalıdır. CLI'nin verdiği Program ID'yi kaydedin; program adresini `anchor keys sync` tekrar yazar.
6. Dağıtım sonrası `anchor test --skip-local-validator` ile Devnet testlerini çalıştırın (testler eklendikten sonra). Test cüzdanında yeterli Devnet SOL ve deneyeceğiniz SPL token bulunmalıdır.

## Uygulama entegrasyonu durumu

Arayüzün gerçek işlemler gönderebilmesi için IDL ve gerçek Program ID ile Anchor istemcisi bağlanmalı. Şu an bu bağlantı eklenmiş değildir. On-chain başvurularda metin herkese açık kalır. Dosya kanıtları için ayrıca IPFS/Arweave gibi saklama katmanı, erişim modeli ve açık kullanıcı izni gerekir; özel belgeleri doğrudan zincire yazmayın.

## Program komutları

- `create_sol_pool(pool_id, amount_lamports, slots)`
- `create_token_pool(pool_id, amount_base_units, slots)`
- `apply(message)`
- `select_applicant()`
- `approve_and_distribute()`

SPL havuzu dağıtırken kalan hesaplar her seçili alıcı için `(application PDA, wallet, associated token account)`; SOL için `(application PDA, wallet)` sırasındadır. Program hesapların havuza ait olduğunu, seçilmiş durumda olduğunu ve alıcıların tekrarlanmadığını doğrular.

