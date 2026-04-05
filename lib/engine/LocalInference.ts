import Alert from '@components/views/Alert'
import { AppSettings } from '@lib/constants/GlobalValues'
import { SamplerConfigData, SamplerID, Samplers } from '@lib/constants/SamplerData'
import { Chats, useInference } from '@lib/state/Chat'
import { commonStopStrings, Instructs, outputPrefixes } from '@lib/state/Instructs'
import { Logger } from '@lib/state/Logger'
import { SamplersManager } from '@lib/state/SamplerState'
import { useTTSStore } from '@lib/state/TTS'
import { mmkv } from '@lib/storage/MMKV'
import { CompletionTimings } from 'db/schema'

import { Characters } from '@lib/state/Characters'
import { APIConfiguration, APISampler, APIValues } from './API/APIBuilder.types'
import {
    buildChatCompletionContext,
    buildTextCompletionContext,
    ContextBuilderParams,
} from './API/ContextBuilder'
import { Llama, LlamaConfig } from './Local/LlamaLocal'
import { KV } from './Local/Model'

export const localSamplerData: APISampler[] = [
    { externalName: 'n_predict', samplerID: SamplerID.GENERATED_LENGTH },
    { externalName: 'temperature', samplerID: SamplerID.TEMPERATURE },
    { externalName: 'top_p', samplerID: SamplerID.TOP_P },
    { externalName: 'top_k', samplerID: SamplerID.TOP_K },
    { externalName: 'min_p', samplerID: SamplerID.MIN_P },
    { externalName: 'typical_p', samplerID: SamplerID.TYPICAL },
    { externalName: 'mirostat', samplerID: SamplerID.MIROSTAT_MODE },
    { externalName: 'mirostat_tau', samplerID: SamplerID.MIROSTAT_TAU },
    { externalName: 'mirostat_eta', samplerID: SamplerID.MIROSTAT_ETA },
    { externalName: 'grammar', samplerID: SamplerID.GRAMMAR_STRING },
    { externalName: 'penalty_last_n', samplerID: SamplerID.REPETITION_PENALTY_RANGE },
    { externalName: 'penalty_repeat', samplerID: SamplerID.REPETITION_PENALTY },
    { externalName: 'penalty_present', samplerID: SamplerID.PRESENCE_PENALTY },
    { externalName: 'penalty_freq', samplerID: SamplerID.FREQUENCY_PENALTY },
    { externalName: 'xtc_t', samplerID: SamplerID.XTC_THRESHOLD },
    { externalName: 'xtc_p', samplerID: SamplerID.XTC_PROBABILITY },
    { externalName: 'seed', samplerID: SamplerID.SEED },
    { externalName: 'dry_base', samplerID: SamplerID.DRY_BASE },
    { externalName: 'dry_allowed_length', samplerID: SamplerID.DRY_ALLOWED_LENGTH },
    { externalName: 'dry_multiplier', samplerID: SamplerID.DRY_MULTIPLIER },
    { externalName: 'dry_sequence_breakers', samplerID: SamplerID.DRY_SEQUENCE_BREAK },
]

const getSamplerFields = (max_length?: number) => {
    const preset: SamplerConfigData = SamplersManager.getCurrentSampler()
    return localSamplerData
        .map((item: APISampler) => {
            const value = preset[item.samplerID]
            const samplerItem = Samplers[item.samplerID]
            let cleanvalue = value
            if (typeof value === 'number')
                if (item.samplerID === 'max_length' && max_length) {
                    cleanvalue = Math.min(value, max_length)
                } else if (samplerItem.values.type === 'integer') cleanvalue = Math.floor(value)
            if (item.samplerID === SamplerID.DRY_SEQUENCE_BREAK) {
                //@ts-expect-error. This is due to a migration
                cleanvalue = (value as string).split(',')
            }
            return { [item.externalName as SamplerID]: cleanvalue }
        })
        .reduce((acc, obj) => Object.assign(acc, obj), {})
}

const buildLocalPayload = async () => {
    const payloadFields = getSamplerFields()
    const rep_pen = payloadFields?.['penalty_repeat']
    const localPreset: LlamaConfig = Llama.useLlamaPreferencesStore.getState().config
    let prompt: undefined | string = undefined
    let mediaPaths: string[] = []
    const context = Llama.useLlamaModelStore.getState().context

    const fields = await obtainFields()

    if (!fields) {
        return Logger.error('Failed to build fields')
    }

    const { apiConfig, ...rest } = fields

    const completionType = apiConfig.request.completionType
    if (context && (await context.isMultimodalEnabled())) {
        const mtmdSupport = await context.getMultimodalSupport()
        if (completionType.type === 'chatCompletions') {
            completionType.supportsAudio = mtmdSupport?.audio
            completionType.supportsImages = mtmdSupport?.vision
            apiConfig.request.completionType = completionType
        }
    }
    const hasAudio = completionType.type === 'chatCompletions' && completionType.supportsAudio
    const hasImage = completionType.type === 'chatCompletions' && completionType.supportsImages
    const bufferExists = !!Chats.useChatState.getState().buffer.data

    if (mmkv.getBoolean(AppSettings.UseModelTemplate)) {
        const messages = await buildChatCompletionContext({ apiConfig, ...rest })
        try {
            if (messages) {
                const result = await Llama.useLlamaModelStore
                    .getState()
                    .context?.getFormattedChat(messages, null, {
                        jinja: true,
                    })
                if (typeof result === 'string') prompt = result
                else if (typeof result === 'object') {
                    prompt = result.prompt
                    mediaPaths = result.media_paths ?? []
                    if (mediaPaths.length > 0 && !hasImage && !hasAudio) {
                        Logger.warnToast('Media was added without multimodal support.')
                    }
                }
            }
        } catch (e) {
            Logger.error(`Failed to use template: ${e}`)
        }

        if (bufferExists && prompt) {
            const removalList = ['<think>', ...outputPrefixes, ...commonStopStrings]
            let trimmedInput = prompt.trim()
            for (const removal of removalList) {
                const test = removal.trim()
                if (trimmedInput.endsWith(test)) {
                    const matchIndex = trimmedInput.lastIndexOf(test)
                    if (matchIndex !== -1) {
                        trimmedInput = trimmedInput.slice(0, matchIndex).trim()
                    }
                }
            }
            prompt = trimmedInput
        }
    }
    if (!prompt) {
        prompt = await buildTextCompletionContext({ apiConfig, ...rest })
    }

    if (!prompt) {
        Logger.errorToast('Failed to build prompt')
        return
    }

    const finalMediaPaths = hasAudio || hasImage ? { media_paths: mediaPaths } : {}

    return {
        ...payloadFields,
        penalize_nl: typeof rep_pen === 'number' && rep_pen > 1,
        n_threads: localPreset.threads,
        prompt: prompt ?? '',
        stop: constructStopSequence(),
        emit_partial_completion: true,
        ...finalMediaPaths,
    }
}

const constructStopSequence = (): string[] => {
    return Instructs.useInstruct.getState().getStopSequence()
}

const stopGenerating = () => {
    Chats.useChatState.getState().stopGenerating()
}

const constructReplaceStrings = (): string[] => {
    const stops: string[] = constructStopSequence()
    return stops
}

const verifyModelLoaded = async (): Promise<boolean> => {
    const model = Llama.useLlamaModelStore.getState().model

    if (!model) {
        const lastModel = Llama.useLlamaPreferencesStore.getState().lastModel
        const autoLoad = mmkv.getBoolean(AppSettings.AutoLoadLocal)
        if (!autoLoad) {
            Logger.warnToast('No Model Loaded')
            return false
        }

        if (!lastModel) {
            Logger.warnToast('No Auto-Load Model Set')
            return false
        }

        if (lastModel) {
            Logger.infoToast(`Auto-loading Model: ${lastModel.name}`)
            await Llama.useLlamaModelStore.getState().load(lastModel)
        }

        const lastMmproj = Llama.useLlamaPreferencesStore.getState().lastMmproj
        if (lastMmproj) {
            Logger.infoToast(`Auto-loading MMPROJ: ${lastMmproj.name}`)
            await Llama.useLlamaModelStore.getState().loadMmproj(lastMmproj)
        }
    }
    return true
}

export const localInference = async () => {
    try {
        if (!(await verifyModelLoaded())) {
            return stopGenerating()
        }

        const context = Llama.useLlamaModelStore.getState().context

        if (!context) {
            Logger.warnToast('No Model Loaded')
            stopGenerating()
            return
        }

        const payload = await buildLocalPayload()

        if (!payload) {
            Logger.warnToast('Failed to build payload')
            stopGenerating()
            return
        }

        if (mmkv.getBoolean(AppSettings.SaveLocalKV) && !KV.useKVStore.getState().kvCacheLoaded) {
            const prompt = Llama.useLlamaModelStore
                .getState()
                .tokenize(payload.prompt, payload.media_paths)
            const result = KV.useKVStore.getState().verifyKVCache(prompt?.tokens ?? [])
            if (!result.match) {
                Alert.alert({
                    title: 'Cache Mismatch',
                    description: `KV Cache does not match current prompt:\n\n${result.matchLength} of ${result.cachedLength} tokens are identical.\n\nPress 'Load Anyway' if you don't mind losing the cache.`,
                    buttons: [
                        { label: 'Cancel', onPress: stopGenerating },
                        {
                            label: 'Load Anyway',
                            onPress: async () => {
                                Logger.warn('Overriding KV Cache despite mismatch')
                                const result = await Llama.useLlamaModelStore.getState().loadKV()
                                if (result) {
                                    KV.useKVStore.getState().setKvCacheLoaded(true)
                                }
                                runLocalCompletion(payload)
                            },
                            type: 'warning',
                        },
                    ],
                    onDismiss: stopGenerating,
                })
                return
            }

            const kvloadResult = await Llama.useLlamaModelStore.getState().loadKV()
            if (kvloadResult) {
                KV.useKVStore.getState().setKvCacheLoaded(true)
            }
        }
        await runLocalCompletion(payload)
    } catch (e) {
        Logger.errorToast('Failed to run local inference: ' + e)
        stopGenerating()
    }
}

// ==========================================
// 🚀 GEMU EDITION: LOCAL LIVE TITLE GENERATOR
// ==========================================
const generateLocalTitle = async (chatId: number) => {
    const llamaContext = Llama.useLlamaModelStore.getState().context;
    if (!llamaContext) return;

    Chats.useChatState.getState().renameChat(chatId, '✨ Naming Chat...');

    const chat = Chats.useChatState.getState().data;
    if (!chat) return;

    // Grab first 2 user messages and the first AI response to give context
    const conversation = chat.messages
        .slice(0, 3)
        .map(m => `${m.is_user ? 'User' : 'AI'}: ${m.swipes[m.swipe_id]?.swipe || ''}`)
        .join('\n');

    const metaPrompt = `System: You are an AI that generates extremely short, 2 to 4 word titles for conversations. Output ONLY the title. Do not use quotes or punctuation.\n\nConversation:\n${conversation}\n\nTitle:`;

    let generatedTitle = "";
    let progress = 10;

    try {
        const result = await llamaContext.completion(
            {
                prompt: metaPrompt,
                n_predict: 15, // Keep it very short
                temperature: 0.3,
                stop: ["\n", "<|im_end|>", "</s>", "[/INST]", "<|eot_id|>"],
            },
            (data: any) => {
                generatedTitle += data.token;
                progress = Math.min(95, progress + 15);
                // Update the chat drawer name live with the progress!
                Chats.useChatState.getState().renameChat(chatId, `✨ Naming... ${progress}%`);
            }
        );

        const finalText = result.text ? result.text.trim() : generatedTitle.trim();
        const cleanTitle = finalText.replace(/["'.]/g, '').replace(/\b\w/g, (c) => c.toUpperCase()).substring(0, 50);

        if (cleanTitle) {
            Chats.useChatState.getState().renameChat(chatId, cleanTitle);
        } else {
            Chats.useChatState.getState().renameChat(chatId, 'New Chat');
        }
    } catch (error) {
        Logger.errorToast("Title Generation Failed: " + error);
        Chats.useChatState.getState().renameChat(chatId, 'New Chat');
    }
};
// ==========================================

const runLocalCompletion = async (
    payload: NonNullable<Awaited<ReturnType<typeof buildLocalPayload>>>
) => {
    const replace = RegExp(
        constructReplaceStrings()
            .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join(`|`),
        'g'
    )

    useInference.getState().setAbort(async () => {
        await Llama.useLlamaModelStore.getState().stopCompletion()
    })

    const outputStream = (text: string) => {
        Chats.useChatState.getState().insertBuffer(text)
        useTTSStore.getState().insertBuffer(text)
    }

    const outputCompleted = (text: string, timings: CompletionTimings) => {
        const regenCache = Chats.useChatState.getState().getRegenCache()
        Chats.useChatState
            .getState()
            .setBuffer({ data: (regenCache + text).replaceAll(replace, ''), timings: timings })
        if (mmkv.getBoolean(AppSettings.PrintContext)) Logger.info(`Completion Output:\n${text}`)
        stopGenerating()

        // 🚀 GEMU EDITION: Smart Title Generation Hook
        setTimeout(() => {
            const chat = Chats.useChatState.getState().data
            if (mmkv.getBoolean(AppSettings.AutoGenerateTitle) && chat && chat.name === 'New Chat') {
                const userMessageCount = chat.messages.filter((m) => m.is_user).length
                // Wait for exactly 2 user messages
                if (userMessageCount >= 2) {
                    generateLocalTitle(chat.id)
                }
            }
        }, 500); // 500ms delay to let the main UI update first
    }

    await Llama.useLlamaModelStore
        .getState()
        .completion(payload, outputStream, outputCompleted)
        .catch((error) => {
            Logger.errorToast(`Failed to generate locally: ${error}`)
            stopGenerating()
        })
}

const localAPIValues: APIValues = {
    endpoint: '',
    modelEndpoint: '',
    prefill: '',
    firstMessage: '',
    key: '',
    model: undefined,
    configName: 'Local',
}

const localAPIConfig: APIConfiguration = {
    version: 1,
    name: 'Local',

    defaultValues: {
        endpoint: '',
        modelEndpoint: '',
        prefill: '',
        firstMessage: '',
        key: '',
        model: undefined,
    },

    features: {
        usePrefill: false,
        useFirstMessage: false,
        useKey: true,
        useModel: true,
        multipleModels: false,
    },

    request: {
        requestType: 'stream',
        samplerFields: [],
        completionType: {
            type: 'chatCompletions',
            userRole: 'user',
            systemRole: 'system',
            assistantRole: 'assistant',
            contentName: 'content',
        },
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        responseParsePattern: 'choices.0.delta.content',
        useStop: true,
        stopKey: 'stop',
        promptKey: 'messages',
        removeLength: true,
    },

    payload: {
        type: 'openai',
    },

    model: {
        useModelContextLength: false,
        nameParser: '',
        contextSizeParser: '',
        modelListParser: '',
    },

    ui: {
        editableCompletionPath: false,
        editableModelPath: false,
        selectableModel: false,
    },
}

const obtainFields = async (): Promise<ContextBuilderParams | void> => {
    try {
        const userState = Characters.useUserStore.getState()
        const characterState = Characters.useCharacterStore.getState()
        const chatState = Chats.useChatState.getState()

        const instructState = Instructs.useInstruct.getState()

        const userCard = userState.card
        if (!userCard) {
            Logger.errorToast('No loaded user')
            return
        }

        const characterCard = characterState.card
        if (!characterCard) {
            Logger.errorToast('No loaded character')
            return
        }
        const messages = chatState.data?.messages
        if (!messages) {
            Logger.errorToast('No chat character')
            return
        }

        const apiValues = localAPIValues
        if (!apiValues) {
            Logger.warnToast(`No Active API`)
            return
        }

        const apiConfig = localAPIConfig
        if (!apiConfig) {
            Logger.errorToast(`Configuration "${apiValues?.configName}" not found`)
            return
        }

        const engineData = Llama.useLlamaPreferencesStore.getState().config
        const samplers = SamplersManager.getCurrentSampler()

        const instructLength = engineData.context_length
        const length = Math.max(instructLength - samplers.genamt, 0)

        return {
            apiConfig: Object.assign({}, apiConfig),
            apiValues: Object.assign({}, apiValues),

            instruct: instructState.replacedMacros(),
            character: Object.assign({}, characterCard),
            user: Object.assign({}, userCard),
            messages: [...messages],
            chatTokenizer: async (entry, index) => {
                if (entry.id === -1) return 0
                return await chatState.getTokenCount(index)
            },
            tokenizer: Llama.useLlamaModelStore.getState().tokenLength,
            maxLength: length,
            cache: {
                userCache: await characterState.getCache(characterCard.name),
                characterCache: await userState.getCache(userCard.name),
                instructCache: await instructState.getCache(characterCard.name, userCard.name),
            },
        }
    } catch (e) {
        Logger.errorToast('Failed to orchestrate request build: ' + e)
    }
}
